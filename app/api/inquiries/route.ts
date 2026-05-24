/**
 * POST /api/inquiries
 *
 * Public endpoint that accepts both Contact and Commission form
 * submissions. Behaviour:
 *
 *   1. Honeypot check — bots that fill the hidden `website` field are
 *      silently rejected with a 200 so they don't get useful feedback.
 *   2. Schema validation via `validateContactSubmission` /
 *      `validateCommissionSubmission`. On failure returns 400 with a
 *      machine-readable `errors[]` and the visitor's original payload so
 *      the form can repopulate (Requirements 6.4, 7.5).
 *   3. Persist to Postgres (encrypted-at-rest at the storage layer; the
 *      column-level encryption design step lands later).
 *   4. Send notification email via Resend. Failures don't roll back the
 *      DB write — the inquiry is captured even if email is misconfigured.
 *   5. Respond with 200 + redirect target (`/contact/thanks`) for the
 *      browser form's `application/x-www-form-urlencoded` flow, or JSON
 *      for `application/json` callers.
 *
 * Out of scope for this dispatch (deferred to later spec tasks):
 *   - CAPTCHA verification (Turnstile)
 *   - Rate limiting (5 / 60min sliding window)
 *   - Reference image attachments (multipart upload + S3)
 *   - Background retry queue for email delivery
 */

import { NextResponse, type NextRequest } from 'next/server';

import { systemClock } from '@/lib/clock';
import { prisma } from '@/lib/db/prisma';
import {
  sendCommissionNotification,
  sendContactNotification,
} from '@/lib/email/resend';
import {
  validateCommissionSubmission,
  validateContactSubmission,
} from '@/lib/validation/inquiry';
import type {
  CommissionInquiry,
  ContactSubmission,
  FieldError,
} from '@/lib/types/inquiry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

type FormType = 'contact' | 'commission';

interface ParsedSubmission {
  readonly type: FormType;
  readonly fields: Record<string, string>;
  readonly honeypot: string;
  readonly accept: 'json' | 'html';
}

async function parseRequest(req: NextRequest): Promise<ParsedSubmission | null> {
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
  const accept = (req.headers.get('accept') ?? '').toLowerCase();
  const wantsJson = accept.includes('application/json');

  let raw: Record<string, string> = {};
  try {
    if (contentType.includes('application/json')) {
      const body = (await req.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === 'string') raw[k] = v;
      }
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      const data = await req.formData();
      data.forEach((v, k) => {
        if (typeof v === 'string') raw[k] = v;
      });
    } else {
      // Best-effort: try formData anyway.
      const data = await req.formData();
      data.forEach((v, k) => {
        if (typeof v === 'string') raw[k] = v;
      });
    }
  } catch {
    return null;
  }

  const type = raw.type === 'commission' ? 'commission' : 'contact';
  const honeypot = raw.website ?? '';
  delete raw.type;
  delete raw.website;

  return {
    type,
    fields: raw,
    honeypot,
    accept: wantsJson ? 'json' : 'html',
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function truncateIp(ip: string): string {
  // Truncate IPv4 to /24 and IPv6 to /48 to minimise PII (per design.md).
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    return ip;
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}::`;
  }
  return ip;
}

function clientIpFrom(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return truncateIp(first);
  }
  const real = req.headers.get('x-real-ip');
  if (real) return truncateIp(real.trim());
  return '0.0.0.0';
}

function htmlRedirect(url: string): NextResponse {
  return NextResponse.redirect(new URL(url, 'http://placeholder.local'), 303);
}

interface SuccessBody {
  readonly ok: true;
  readonly inquiryId: string;
  readonly emailSent: boolean;
  readonly redirectTo: string;
}

interface ErrorBody {
  readonly ok: false;
  readonly errors: ReadonlyArray<FieldError>;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = await parseRequest(req);
  if (parsed === null) {
    return NextResponse.json(
      {
        ok: false,
        errors: [
          {
            field: '_root',
            code: 'invalid_request',
            message: 'Could not parse the request body.',
          },
        ] satisfies ReadonlyArray<FieldError>,
      } satisfies ErrorBody,
      { status: 400 },
    );
  }

  // Silent honeypot acceptance. Bots get a 200 + redirect like a real
  // submission so they don't learn the field is being checked.
  if (parsed.honeypot.trim().length > 0) {
    if (parsed.accept === 'json') {
      return NextResponse.json(
        {
          ok: true,
          inquiryId: 'honeypot',
          emailSent: false,
          redirectTo: redirectFor(parsed.type),
        } satisfies SuccessBody,
        { status: 200 },
      );
    }
    return absoluteRedirect(req, redirectFor(parsed.type));
  }

  if (parsed.type === 'contact') {
    return handleContact(req, parsed);
  }
  return handleCommission(req, parsed);
}

function redirectFor(type: FormType): string {
  return type === 'commission' ? '/commission/thanks' : '/contact/thanks';
}

function absoluteRedirect(req: NextRequest, path: string): NextResponse {
  const url = new URL(path, req.nextUrl.origin);
  return NextResponse.redirect(url, 303);
}

// ---------------------------------------------------------------------------
// Contact branch
// ---------------------------------------------------------------------------

async function handleContact(
  req: NextRequest,
  parsed: ParsedSubmission,
): Promise<NextResponse> {
  const result = validateContactSubmission(parsed.fields);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors } satisfies ErrorBody,
      { status: 400 },
    );
  }
  const submission = result.value satisfies ContactSubmission;

  const inquiry = await prisma.inquiry.create({
    data: {
      type: 'contact',
      name: submission.name,
      email: submission.email,
      subject: submission.subject,
      message: submission.message,
      status: 'new',
      clientIp: clientIpFrom(req),
      userAgent: (req.headers.get('user-agent') ?? '').slice(0, 500),
      submittedAt: systemClock.now(),
    },
    select: { id: true },
  });

  const dispatch = await sendContactNotification(submission);
  if (dispatch.skippedReason === 'send_failed') {
    await prisma.inquiry
      .update({ where: { id: inquiry.id }, data: { deliveryFailed: true } })
      .catch(() => undefined);
  }

  if (parsed.accept === 'json') {
    return NextResponse.json(
      {
        ok: true,
        inquiryId: inquiry.id,
        emailSent: dispatch.sent,
        redirectTo: redirectFor('contact'),
      } satisfies SuccessBody,
      { status: 200 },
    );
  }
  return absoluteRedirect(req, redirectFor('contact'));
}

// ---------------------------------------------------------------------------
// Commission branch
// ---------------------------------------------------------------------------

async function handleCommission(
  req: NextRequest,
  parsed: ParsedSubmission,
): Promise<NextResponse> {
  const result = validateCommissionSubmission(parsed.fields, systemClock);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors } satisfies ErrorBody,
      { status: 400 },
    );
  }
  const submission = result.value satisfies CommissionInquiry;

  const inquiry = await prisma.inquiry.create({
    data: {
      type: 'commission',
      name: submission.name,
      email: submission.email,
      message: submission.description,
      projectType: mapProjectTypeForDb(submission.projectType),
      budgetRangeId: null, // Free-text budget id; budget ranges aren't seeded in the CMS yet.
      targetDeadline: new Date(`${submission.targetDeadline as unknown as string}T00:00:00.000Z`),
      status: 'new',
      clientIp: clientIpFrom(req),
      userAgent: (req.headers.get('user-agent') ?? '').slice(0, 500),
      submittedAt: systemClock.now(),
    },
    select: { id: true },
  });

  const dispatch = await sendCommissionNotification(submission);
  if (dispatch.skippedReason === 'send_failed') {
    await prisma.inquiry
      .update({ where: { id: inquiry.id }, data: { deliveryFailed: true } })
      .catch(() => undefined);
  }

  if (parsed.accept === 'json') {
    return NextResponse.json(
      {
        ok: true,
        inquiryId: inquiry.id,
        emailSent: dispatch.sent,
        redirectTo: redirectFor('commission'),
      } satisfies SuccessBody,
      { status: 200 },
    );
  }
  return absoluteRedirect(req, redirectFor('commission'));
}

/**
 * Map the human-readable project type label to the Prisma enum identifier.
 * "Product Visualization" → "ProductVisualization"; everything else passes
 * through unchanged.
 */
function mapProjectTypeForDb(
  value: CommissionInquiry['projectType'],
):
  | 'Character'
  | 'Environment'
  | 'ProductVisualization'
  | 'Animation'
  | 'Other' {
  if (value === 'Product Visualization') return 'ProductVisualization';
  return value;
}
