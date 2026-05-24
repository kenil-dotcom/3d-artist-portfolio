'use client';

/**
 * CommissionForm — client-side submission with inline error handling and
 * a future-only date picker.
 *
 * Behaviour:
 *   - Posts JSON to `/api/inquiries`, reads the structured response, and
 *     redirects to /commission/thanks on success.
 *   - Per-field inline error messages on failure; visitor's entered
 *     values are preserved across validation failures (Requirement 7.5).
 *   - The deadline `<input type="date">` has `min` set to today (computed
 *     client-side at mount) so the native picker can't select a past day.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';

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

const PROJECT_TYPES: ReadonlyArray<string> = [
  'Character',
  'Environment',
  'Product Visualization',
  'Animation',
  'Other',
];

const BUDGET_RANGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'lt-1k', label: 'Less than $1,000' },
  { value: '1k-5k', label: '$1,000 – $5,000' },
  { value: '5k-15k', label: '$5,000 – $15,000' },
  { value: '15k-50k', label: '$15,000 – $50,000' },
  { value: 'gt-50k', label: '$50,000+' },
];

const ROOT_ERROR_KEY = '_root';

function todayKey(): string {
  // Client-local date in `YYYY-MM-DD`. Matches the picker's value space.
  const d = new Date();
  const y = d.getFullYear().toString().padStart(4, '0');
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function CommissionForm(): ReactElement {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [minDate, setMinDate] = useState<string>('');

  useEffect(() => {
    setMinDate(todayKey());
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});
    setRootError(null);
    setSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload: Record<string, string> = { type: 'commission' };
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
        router.push(body.redirectTo ?? '/commission/thanks');
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
      setRootError(`Could not send your inquiry. ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-6">
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

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          id="commission-name"
          name="name"
          label="Name"
          type="text"
          autoComplete="name"
          required
          maxLength={100}
          placeholder="Your name"
          error={errors.name}
        />
        <Field
          id="commission-email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="you@example.com"
          error={errors.email}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <SelectField
          id="commission-project-type"
          name="projectType"
          label="Project type"
          options={PROJECT_TYPES.map((p) => ({ value: p, label: p }))}
          placeholder="Select a project type"
          required
          error={errors.projectType}
        />
        <SelectField
          id="commission-budget"
          name="budgetRangeId"
          label="Budget range"
          options={BUDGET_RANGES}
          placeholder="Select a budget range"
          required
          error={errors.budgetRangeId}
        />
      </div>

      <DateField
        id="commission-deadline"
        name="targetDeadline"
        label="Target deadline"
        min={minDate}
        required
        error={errors.targetDeadline}
      />

      <Textarea
        id="commission-description"
        name="description"
        label="Project description"
        required
        minLength={20}
        maxLength={5000}
        rows={7}
        placeholder="Tell me about the goal, deliverables, and any reference images you have."
        error={errors.description}
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
          data-cursor-label={submitting ? 'sending' : "let's go"}
          aria-busy={submitting}
        >
          {submitting ? 'Sending…' : 'Send inquiry'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

interface FieldProps {
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

function Field({
  id,
  name,
  label,
  type,
  required,
  maxLength,
  placeholder,
  autoComplete,
  error,
}: FieldProps): ReactElement {
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

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface SelectFieldProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly options: ReadonlyArray<SelectOption>;
  readonly placeholder: string;
  readonly required?: boolean;
  readonly error: string | undefined;
}

function SelectField({
  id,
  name,
  label,
  options,
  placeholder,
  required,
  error,
}: SelectFieldProps): ReactElement {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="label-field">
        {label}
      </label>
      <select
        id={id}
        name={name}
        required={required}
        defaultValue=""
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className={`input-field ${error !== undefined ? 'border-accent/80' : ''}`}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error !== undefined ? (
        <p id={errorId} className="mt-2 text-xs text-accent">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface DateFieldProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly min: string;
  readonly required?: boolean;
  readonly error: string | undefined;
}

function DateField({
  id,
  name,
  label,
  min,
  required,
  error,
}: DateFieldProps): ReactElement {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="label-field">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="date"
        required={required}
        min={min === '' ? undefined : min}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className={`input-field ${error !== undefined ? 'border-accent/80' : ''}`}
      />
      <p className="mt-1 text-xs text-muted">
        Pick any date from today onward.
      </p>
      {error !== undefined ? (
        <p id={errorId} className="mt-2 text-xs text-accent">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextareaProps {
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

function Textarea({
  id,
  name,
  label,
  required,
  minLength,
  maxLength,
  rows,
  placeholder,
  error,
}: TextareaProps): ReactElement {
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

export default CommissionForm;
