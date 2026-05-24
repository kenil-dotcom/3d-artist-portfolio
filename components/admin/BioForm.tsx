'use client';

/**
 * Bio main form.
 *
 * Handles artist name, tagline, biography, chip lists for skills and
 * software, and a repeatable list of social links. Wraps the `saveBio`
 * server action with `useFormState` so server-side validation feedback
 * is rendered inline.
 */

import { useFormState, useFormStatus } from 'react-dom';
import {
  useId,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';

import {
  saveBio,
  INITIAL_BIO_STATE,
  type SaveBioState,
} from '@/app/admin/(protected)/bio/actions';

interface SocialLinkInput {
  readonly platform: string;
  readonly url: string;
}

interface BioInitial {
  readonly artistName: string;
  readonly tagline: string;
  readonly biography: string;
  readonly skills: ReadonlyArray<string>;
  readonly software: ReadonlyArray<string>;
  readonly socialLinks: ReadonlyArray<SocialLinkInput>;
}

interface BioFormProps {
  readonly initial: BioInitial;
}

export function BioForm({ initial }: BioFormProps): ReactElement {
  const [state, formAction] = useFormState<SaveBioState, FormData>(
    saveBio,
    INITIAL_BIO_STATE,
  );

  const [skills, setSkills] = useState<ReadonlyArray<string>>(initial.skills);
  const [software, setSoftware] = useState<ReadonlyArray<string>>(initial.software);
  const [socialLinks, setSocialLinks] = useState<ReadonlyArray<SocialLinkInput>>(
    initial.socialLinks.length === 0
      ? [{ platform: '', url: '' }]
      : initial.socialLinks,
  );

  return (
    <form
      action={formAction}
      className="surface-card space-y-6 p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-caramel))]"
    >
      {state.status === 'success' ? (
        <p
          role="status"
          className="rounded-2xl border-2 border-foreground bg-[hsl(var(--color-pop-sage)/0.4)] px-4 py-3 text-sm font-medium text-foreground"
        >
          {state.message ?? 'Bio saved.'}
        </p>
      ) : null}
      {state.status === 'error' && state.message !== null ? (
        <p
          role="alert"
          className="rounded-2xl border-2 border-foreground bg-[hsl(var(--color-pop-amber)/0.3)] px-4 py-3 text-sm font-medium text-foreground"
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Field
          id="artistName"
          name="artistName"
          label="Artist name"
          required
          defaultValue={initial.artistName}
          maxLength={100}
          error={state.errors['artistName']}
        />
        <Field
          id="tagline"
          name="tagline"
          label="Tagline"
          required
          defaultValue={initial.tagline}
          maxLength={160}
          error={state.errors['tagline']}
        />
      </div>

      <div>
        <label htmlFor="biography" className="label-field">
          Biography
        </label>
        <textarea
          id="biography"
          name="biography"
          rows={8}
          maxLength={5000}
          defaultValue={initial.biography}
          aria-invalid={state.errors['biography'] !== undefined}
          aria-describedby={
            state.errors['biography'] !== undefined ? 'biography-error' : undefined
          }
          className="input-field resize-y"
        />
        {state.errors['biography'] !== undefined ? (
          <p
            id="biography-error"
            className="mt-2 text-xs font-medium text-[hsl(var(--color-pop-amber))]"
          >
            {state.errors['biography']}
          </p>
        ) : null}
      </div>

      <ChipList
        label="Skills"
        name="skills"
        items={skills}
        onChange={setSkills}
        error={state.errors['skills']}
      />
      <ChipList
        label="Software"
        name="software"
        items={software}
        onChange={setSoftware}
        error={state.errors['software']}
      />

      <SocialLinksField
        socialLinks={socialLinks}
        onChange={setSocialLinks}
        errors={state.errors}
      />

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

interface FieldProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly required?: boolean;
  readonly defaultValue: string;
  readonly maxLength?: number;
  readonly error: string | undefined;
}

function Field({
  id,
  name,
  label,
  required,
  defaultValue,
  maxLength,
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
        type="text"
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className="input-field"
      />
      {error !== undefined ? (
        <p
          id={errorId}
          className="mt-2 text-xs font-medium text-[hsl(var(--color-pop-amber))]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ChipList({
  label,
  name,
  items,
  onChange,
  error,
}: {
  readonly label: string;
  readonly name: string;
  readonly items: ReadonlyArray<string>;
  readonly onChange: (next: ReadonlyArray<string>) => void;
  readonly error: string | undefined;
}): ReactElement {
  const [draft, setDraft] = useState('');
  const errorId = useId();
  const inputId = useId();

  function add(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || items.includes(trimmed)) {
      setDraft('');
      return;
    }
    onChange([...items, trimmed]);
    setDraft('');
  }

  function remove(value: string): void {
    onChange(items.filter((v) => v !== value));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && draft.length === 0 && items.length > 0) {
      const last = items[items.length - 1];
      if (last !== undefined) remove(last);
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className="label-field">
        {label}
      </label>
      <div className="mb-3 flex flex-wrap gap-2">
        {items.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-honey))] px-3 py-1 text-xs font-semibold text-foreground"
          >
            {value}
            <button
              type="button"
              onClick={() => remove(value)}
              aria-label={`Remove ${value}`}
              className="rounded-full px-1 hover:bg-background/50"
            >
              ×
            </button>
          </span>
        ))}
        {items.length === 0 ? (
          <span className="text-xs text-muted">No entries yet.</span>
        ) : null}
      </div>
      <input
        id={inputId}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder="Type and press Enter…"
        maxLength={60}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className="input-field"
      />
      {items.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}
      {error !== undefined ? (
        <p
          id={errorId}
          className="mt-2 text-xs font-medium text-[hsl(var(--color-pop-amber))]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SocialLinksField({
  socialLinks,
  onChange,
  errors,
}: {
  readonly socialLinks: ReadonlyArray<SocialLinkInput>;
  readonly onChange: (next: ReadonlyArray<SocialLinkInput>) => void;
  readonly errors: Readonly<Record<string, string>>;
}): ReactElement {
  function update(index: number, patch: Partial<SocialLinkInput>): void {
    onChange(
      socialLinks.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    );
  }

  function add(): void {
    if (socialLinks.length >= 15) return;
    onChange([...socialLinks, { platform: '', url: '' }]);
  }

  function remove(index: number): void {
    const next = socialLinks.filter((_, i) => i !== index);
    onChange(next.length === 0 ? [{ platform: '', url: '' }] : next);
  }

  return (
    <fieldset className="space-y-3">
      <legend className="label-field">Social links</legend>
      {socialLinks.map((link, index) => {
        const error = errors[`socialLinks[${index}]`];
        return (
          <div
            key={index}
            className="grid gap-2 rounded-2xl border-2 border-foreground/20 bg-surface px-3 py-3 md:grid-cols-[1fr_2fr_auto]"
          >
            <input
              type="text"
              name="socialPlatform"
              value={link.platform}
              onChange={(e) => update(index, { platform: e.target.value })}
              placeholder="Platform (e.g. Instagram)"
              maxLength={40}
              aria-label={`Social link ${index + 1} platform`}
              className="input-field py-2 text-sm"
            />
            <input
              type="url"
              name="socialUrl"
              value={link.url}
              onChange={(e) => update(index, { url: e.target.value })}
              placeholder="https://…"
              maxLength={2048}
              aria-label={`Social link ${index + 1} URL`}
              className="input-field py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => remove(index)}
              className="btn-secondary px-3 py-2 text-xs"
            >
              Remove
            </button>
            {error !== undefined ? (
              <p className="md:col-span-3 text-xs font-medium text-[hsl(var(--color-pop-amber))]">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="btn-secondary px-4 py-2 text-xs"
      >
        + Add social link
      </button>
    </fieldset>
  );
}

function SubmitButton(): ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="btn-primary"
    >
      {pending ? 'Saving…' : 'Save bio'}
    </button>
  );
}
