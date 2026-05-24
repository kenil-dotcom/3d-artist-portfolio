/**
 * Resend-backed email dispatcher.
 *
 * Sends notification emails to the site owner whenever a visitor submits
 * the Contact or Commission form. Designed to fail soft so the site keeps
 * working when the API key isn't configured: the inquiry is still
 * persisted and surfaced in logs even if the email send is skipped.
 *
 * The full retry-and-job-queue dispatcher specified in design.md
 * (NotificationJob with attempt_count, next_run_at) is a later task. This
 * module performs an inline send and returns a result the API route can
 * surface to the visitor.
 *
 * Spec references:
 *   - Requirements 6.2, 6.8: persist + email notify within 60s; retry on
 *     transient failure (retry queue not yet implemented).
 *   - Requirements 7.4, 7.9: same for commission inquiries.
 */

import { Resend } from 'resend';

import type { ContactSubmission, CommissionInquiry } from '@/lib/types/inquiry';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface EmailConfig {
  readonly apiKey: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Read configuration from `process.env`. Returns `null` when any required
 * value is missing so the caller can degrade gracefully (logs the inquiry
 * to console and skips the send, keeps the form working in dev without a
 * Resend account).
 */
function readConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.NOTIFICATION_FROM_EMAIL?.trim();
  const to = process.env.NOTIFICATION_TO_EMAIL?.trim();
  if (!apiKey || !from || !to) {
    return null;
  }
  return { apiKey, from, to };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EmailDispatchResult {
  /** Whether the email was sent. `false` for skipped (no config) and errors. */
  readonly sent: boolean;
  /** Resend message id when `sent === true`. */
  readonly messageId: string | null;
  /** Reason when `sent === false`: 'not_configured' | 'send_failed'. */
  readonly skippedReason: 'not_configured' | 'send_failed' | null;
  /** Underlying error when `skippedReason === 'send_failed'`. */
  readonly errorMessage: string | null;
}

/**
 * Send a notification email for a Contact form submission.
 *
 * Idempotent at the visitor level: if the API key is unset the call is a
 * no-op. Failures are caught and surfaced via `skippedReason`; the caller
 * decides whether to flag delivery failure to the admin.
 */
export async function sendContactNotification(
  submission: ContactSubmission,
): Promise<EmailDispatchResult> {
  const subject = `[Portfolio] New contact: ${truncate(submission.subject, 80)}`;
  const text = renderContactText(submission);
  const html = renderContactHtml(submission);
  return dispatch({
    subject,
    replyTo: submission.email,
    text,
    html,
  });
}

/**
 * Send a notification email for a Commission Inquiry submission.
 */
export async function sendCommissionNotification(
  submission: CommissionInquiry,
): Promise<EmailDispatchResult> {
  const subject = `[Portfolio] Commission: ${truncate(submission.projectType, 40)} — ${truncate(submission.name, 40)}`;
  const text = renderCommissionText(submission);
  const html = renderCommissionHtml(submission);
  return dispatch({
    subject,
    replyTo: submission.email,
    text,
    html,
  });
}

// ---------------------------------------------------------------------------
// Send pipeline
// ---------------------------------------------------------------------------

interface DispatchInput {
  readonly subject: string;
  readonly replyTo: string;
  readonly text: string;
  readonly html: string;
}

async function dispatch(input: DispatchInput): Promise<EmailDispatchResult> {
  const config = readConfig();
  if (config === null) {
    // Fail soft: log the message so the artist can recover the inquiry
    // out of band and the dev experience doesn't require a Resend account.
    // eslint-disable-next-line no-console
    console.warn(
      '[email] RESEND_API_KEY / NOTIFICATION_FROM_EMAIL / NOTIFICATION_TO_EMAIL not configured. Skipping send.',
      { subject: input.subject, replyTo: input.replyTo },
    );
    return {
      sent: false,
      messageId: null,
      skippedReason: 'not_configured',
      errorMessage: null,
    };
  }

  const resend = new Resend(config.apiKey);
  try {
    const result = await resend.emails.send({
      from: config.from,
      to: config.to,
      subject: input.subject,
      replyTo: input.replyTo,
      text: input.text,
      html: input.html,
    });

    if (result.error) {
      // eslint-disable-next-line no-console
      console.error('[email] Resend returned an error:', result.error);
      return {
        sent: false,
        messageId: null,
        skippedReason: 'send_failed',
        errorMessage: result.error.message ?? 'Unknown Resend error',
      };
    }

    return {
      sent: true,
      messageId: result.data?.id ?? null,
      skippedReason: null,
      errorMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[email] Resend send threw:', message);
    return {
      sent: false,
      messageId: null,
      skippedReason: 'send_failed',
      errorMessage: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Renderers (plain text + HTML)
// ---------------------------------------------------------------------------

function renderContactText(s: ContactSubmission): string {
  return [
    'New contact form submission',
    '----------------------------',
    `Name:    ${s.name}`,
    `Email:   ${s.email}`,
    `Subject: ${s.subject}`,
    '',
    'Message:',
    s.message,
    '',
    '— Sent automatically from your portfolio site.',
  ].join('\n');
}

function renderContactHtml(s: ContactSubmission): string {
  return wrapHtml(
    'New contact form submission',
    `
      ${row('Name', escapeHtml(s.name))}
      ${row('Email', `<a href="mailto:${escapeAttr(s.email)}">${escapeHtml(s.email)}</a>`)}
      ${row('Subject', escapeHtml(s.subject))}
      <h3 style="margin-top:24px;">Message</h3>
      <p style="white-space:pre-wrap;">${escapeHtml(s.message)}</p>
    `,
  );
}

function renderCommissionText(s: CommissionInquiry): string {
  return [
    'New commission inquiry',
    '----------------------',
    `Name:         ${s.name}`,
    `Email:        ${s.email}`,
    `Project type: ${s.projectType}`,
    `Budget:       ${s.budgetRangeId as unknown as string}`,
    `Deadline:     ${s.targetDeadline as unknown as string}`,
    '',
    'Description:',
    s.description,
    '',
    '— Sent automatically from your portfolio site.',
  ].join('\n');
}

function renderCommissionHtml(s: CommissionInquiry): string {
  return wrapHtml(
    'New commission inquiry',
    `
      ${row('Name', escapeHtml(s.name))}
      ${row('Email', `<a href="mailto:${escapeAttr(s.email)}">${escapeHtml(s.email)}</a>`)}
      ${row('Project type', escapeHtml(s.projectType))}
      ${row('Budget', escapeHtml(s.budgetRangeId as unknown as string))}
      ${row('Deadline', escapeHtml(s.targetDeadline as unknown as string))}
      <h3 style="margin-top:24px;">Description</h3>
      <p style="white-space:pre-wrap;">${escapeHtml(s.description)}</p>
    `,
  );
}

function wrapHtml(title: string, body: string): string {
  return `<!doctype html>
<html><body style="font-family:system-ui,Segoe UI,Helvetica Neue,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111;background:#fafafa;">
  <h2 style="margin:0 0 16px;font-size:18px;">${escapeHtml(title)}</h2>
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
    ${body}
  </table>
  <p style="margin-top:32px;font-size:12px;color:#666;">Sent automatically from your portfolio site.</p>
</body></html>`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#555;font-size:13px;width:120px;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-size:14px;">${value}</td>
  </tr>`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
