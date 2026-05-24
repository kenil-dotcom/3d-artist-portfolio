'use client';

/**
 * ContactForm — client-side submission with inline error handling.
 *
 * Posts JSON to `/api/inquiries`, reads the structured response, and
 * either redirects to /contact/thanks on success or renders per-field
 * inline error messages on failure. Visitor's entered values are preserved
 * across validation failures (Requirement 6.4).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';

interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

interface SubmissionResponse {
  readonly ok: boolean;
  readonly errors?: ReadonlyArray<FieldError>;
  readonly redirectTo?: string;
}

type FieldName = 'name' | 'email' | 'subject' | 'message';

const HUMAN_LABEL: Record<FieldName, string> = {
  name: 'Name',
  email: 'Email',
  subject: 'Subject',
  message: 'Message',
};

const ROOT_ERROR_KEY = '_root';

export function ContactForm(): ReactElement {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});
    setRootError(null);
    setSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload: Record<string, string> = { type: 'contact' };
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') payload[key] = value;
    }

    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as SubmissionResponse;

      if (res.ok && body.ok) {
        router.push(body.redirectTo ?? '/contact/thanks');
        return;
      }

      const fieldErrors: Record<string, string> = {};
      let topLevel: string | null = null;
      for (const err of body.errors ?? []) {
        if (err.field === ROOT_ERROR_KEY) {
          topLevel = err.message;
        } else {
          fieldErrors[err.field] = err.message;
        }
      }
      setErrors(fieldErrors);
      setRootError(
        topLevel ??
          (res.status === 429
            ? 'Too many submissions. Please try again later.'
            : 'Please review the highlighted fields.'),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error.';
      setRootError(`Could not send your message. ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-6">
      {/* Honeypot — must remain empty; bots that fill every field get
          silently rejected on the server. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      {rootError !== null ? (
        <div
          role="alert"
          className="border border-accent/60 bg-accent/5 px-4 py-3 text-sm text-foreground"
        >
          {rootError}
        </div>
      ) : null}

      <FieldRow
        id="contact-name"
        name="name"
        label={HUMAN_LABEL.name}
        type="text"
        autoComplete="name"
        required
        maxLength={100}
        placeholder="Your name"
        error={errors.name}
      />
      <FieldRow
        id="contact-email"
        name="email"
        label={HUMAN_LABEL.email}
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        placeholder="you@example.com"
        error={errors.email}
      />
      <FieldRow
        id="contact-subject"
        name="subject"
        label={HUMAN_LABEL.subject}
        type="text"
        required
        maxLength={200}
        placeholder="Quick question about a render"
        error={errors.subject}
      />
      <TextareaRow
        id="contact-message"
        name="message"
        label={HUMAN_LABEL.message}
        required
        minLength={10}
        maxLength={5000}
        rows={6}
        placeholder="Tell me a bit about your project."
        error={errors.message}
      />

      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <p className="text-xs text-muted">
          By submitting you agree to the{' '}
          <Link href="/privacy" className="underline hover:text-accent">
            privacy policy
          </Link>
          .
        </p>
        <button
          type="submit"
          className="btn-primary"
          disabled={submitting}
          data-cursor-label={submitting ? 'sending' : 'send it'}
          aria-busy={submitting}
        >
          {submitting ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Field building blocks
// ---------------------------------------------------------------------------

interface FieldRowProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly type: 'text' | 'email';
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly error: string | undefined;
}

function FieldRow({
  id,
  name,
  label,
  type,
  required,
  maxLength,
  placeholder,
  autoComplete,
  error,
}: FieldRowProps): ReactElement {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="label-field">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className={`input-field ${error !== undefined ? 'border-accent/80' : ''}`}
      />
      {error !== undefined ? (
        <p id={errorId} className="mt-2 text-xs text-accent">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextareaRowProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly required?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly error: string | undefined;
}

function TextareaRow({
  id,
  name,
  label,
  required,
  minLength,
  maxLength,
  rows,
  placeholder,
  error,
}: TextareaRowProps): ReactElement {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="label-field">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className={`input-field resize-y ${error !== undefined ? 'border-accent/80' : ''}`}
      />
      {error !== undefined ? (
        <p id={errorId} className="mt-2 text-xs text-accent">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default ContactForm;
