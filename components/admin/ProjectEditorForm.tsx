'use client';

/**
 * Project editor form.
 *
 * Wraps the `saveProject` server action with a `useFormState` so the
 * page renders inline error messages and a success banner without
 * losing form values across submissions.
 *
 * Tags and software are handled as chip lists: each tag/software entry
 * is submitted as a repeated `<input type="hidden" name="...">` so the
 * server-side `formData.getAll(...)` call sees an array of strings.
 */

import { useFormState, useFormStatus } from 'react-dom';
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
  type KeyboardEvent,
} from 'react';

import { slugify } from '@/lib/admin/slug';
import {
  saveProject,
  INITIAL_SAVE_STATE,
  type SaveProjectState,
} from '@/app/admin/(protected)/projects/[id]/edit/actions';

interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

interface TagOption {
  readonly id: string;
  readonly label: string;
}

interface ProjectInitial {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string;
  readonly categoryId: string;
  readonly tagIds: ReadonlyArray<string>;
  readonly softwareUsed: ReadonlyArray<string>;
  readonly creationDate: string;
  readonly status: 'draft' | 'scheduled' | 'published';
  readonly coverMediaId: string | null;
  readonly featuredOrder: string;
}

interface ProjectEditorFormProps {
  readonly projectId: string;
  readonly initial: ProjectInitial;
  readonly categories: ReadonlyArray<CategoryOption>;
  readonly tags: ReadonlyArray<TagOption>;
  readonly showSavedBanner: boolean;
}

export function ProjectEditorForm({
  projectId,
  initial,
  categories,
  tags,
  showSavedBanner,
}: ProjectEditorFormProps): ReactElement {
  const boundAction = useMemo(
    () => saveProject.bind(null, projectId),
    [projectId],
  );
  const [state, formAction] = useFormState<SaveProjectState, FormData>(
    boundAction,
    INITIAL_SAVE_STATE,
  );

  return (
    <form action={formAction} className="space-y-8">
      <Banner state={state} showSavedBanner={showSavedBanner} />

      <section
        aria-labelledby="basics-heading"
        className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-caramel))]"
      >
        <h2
          id="basics-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
        >
          Basics
        </h2>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <TitleAndSlug
            initialTitle={initial.title}
            initialSlug={initial.slug}
            errors={state.errors}
          />
        </div>

        <DescriptionField
          initialValue={initial.description}
          error={state.errors['description']}
        />

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <CategoryField
            value={initial.categoryId}
            categories={categories}
            error={state.errors['categoryId']}
          />
          <CreationDateField
            value={initial.creationDate}
            error={state.errors['creationDate']}
          />
        </div>
      </section>

      <section
        aria-labelledby="taxonomy-heading"
        className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-sage))]"
      >
        <h2
          id="taxonomy-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
        >
          Tags &amp; software
        </h2>

        <div className="mt-6 grid gap-6">
          <TagsField
            available={tags}
            initialIds={initial.tagIds}
            error={state.errors['tagIds']}
          />
          <SoftwareField
            initial={initial.softwareUsed}
            error={state.errors['softwareUsed']}
          />
        </div>
      </section>

      <section
        aria-labelledby="publish-heading"
        className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-amber))]"
      >
        <h2
          id="publish-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
        >
          Publish
        </h2>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <StatusField
            initialStatus={
              initial.status === 'published' ? 'published' : 'draft'
            }
          />
          <FeaturedOrderField
            initial={initial.featuredOrder}
            error={state.errors['featuredOrder']}
          />
          {/* Cover selection is owned by the media manager below — the
              form never writes coverMediaId so it never clobbers a fresh
              "Set as cover" click made between renders. */}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <SubmitButton />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sub components
// ---------------------------------------------------------------------------

function Banner({
  state,
  showSavedBanner,
}: {
  readonly state: SaveProjectState;
  readonly showSavedBanner: boolean;
}): ReactElement | null {
  if (state.status === 'success' || showSavedBanner) {
    return (
      <p
        role="status"
        className="rounded-2xl border-2 border-foreground bg-[hsl(var(--color-pop-sage)/0.4)] px-4 py-3 text-sm font-medium text-foreground"
      >
        {state.message ?? 'Project saved.'}
      </p>
    );
  }
  if (state.status === 'error' && state.message !== null) {
    return (
      <p
        role="alert"
        className="rounded-2xl border-2 border-foreground bg-[hsl(var(--color-pop-amber)/0.3)] px-4 py-3 text-sm font-medium text-foreground"
      >
        {state.message}
      </p>
    );
  }
  return null;
}

function FieldError({
  id,
  message,
}: {
  readonly id: string;
  readonly message: string | undefined;
}): ReactElement | null {
  if (message === undefined) return null;
  return (
    <p id={id} className="mt-2 text-xs font-medium text-[hsl(var(--color-pop-amber))]">
      {message}
    </p>
  );
}

function TitleAndSlug({
  initialTitle,
  initialSlug,
  errors,
}: {
  readonly initialTitle: string;
  readonly initialSlug: string;
  readonly errors: Readonly<Record<string, string>>;
}): ReactElement {
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [autoSlug, setAutoSlug] = useState(initialSlug === slugify(initialTitle));

  useEffect(() => {
    if (autoSlug) {
      setSlug(slugify(title));
    }
  }, [title, autoSlug]);

  return (
    <>
      <div>
        <label htmlFor="title" className="label-field">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors['title'] !== undefined}
          aria-describedby={errors['title'] !== undefined ? 'title-error' : undefined}
          className="input-field"
        />
        <FieldError id="title-error" message={errors['title']} />
      </div>
      <div>
        <label htmlFor="slug" className="label-field">
          Slug
        </label>
        <input
          id="slug"
          name="slug"
          type="text"
          maxLength={80}
          value={slug}
          onChange={(e) => {
            setAutoSlug(false);
            setSlug(e.target.value);
          }}
          aria-invalid={errors['slug'] !== undefined}
          aria-describedby={errors['slug'] !== undefined ? 'slug-error' : undefined}
          className="input-field"
        />
        <p className="mt-1 text-xs text-muted">
          Used as the public URL: <code>/projects/{slug || 'your-slug'}</code>
        </p>
        <FieldError id="slug-error" message={errors['slug']} />
      </div>
    </>
  );
}

function DescriptionField({
  initialValue,
  error,
}: {
  readonly initialValue: string;
  readonly error: string | undefined;
}): ReactElement {
  return (
    <div className="mt-6">
      <label htmlFor="description" className="label-field">
        Description
      </label>
      <textarea
        id="description"
        name="description"
        rows={6}
        maxLength={5000}
        defaultValue={initialValue}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? 'description-error' : undefined}
        className="input-field resize-y"
      />
      <FieldError id="description-error" message={error} />
    </div>
  );
}

function CategoryField({
  value,
  categories,
  error,
}: {
  readonly value: string;
  readonly categories: ReadonlyArray<CategoryOption>;
  readonly error: string | undefined;
}): ReactElement {
  return (
    <div>
      <label htmlFor="categoryId" className="label-field">
        Category
      </label>
      <select
        id="categoryId"
        name="categoryId"
        required
        defaultValue={value}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? 'categoryId-error' : undefined}
        className="input-field"
      >
        <option value="">Choose a category…</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <FieldError id="categoryId-error" message={error} />
    </div>
  );
}

function CreationDateField({
  value,
  error,
}: {
  readonly value: string;
  readonly error: string | undefined;
}): ReactElement {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <label htmlFor="creationDate" className="label-field">
        Creation date
      </label>
      <input
        id="creationDate"
        name="creationDate"
        type="date"
        required
        max={today}
        defaultValue={value}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? 'creationDate-error' : undefined}
        className="input-field"
      />
      <FieldError id="creationDate-error" message={error} />
    </div>
  );
}

function TagsField({
  available,
  initialIds,
  error,
}: {
  readonly available: ReadonlyArray<TagOption>;
  readonly initialIds: ReadonlyArray<string>;
  readonly error: string | undefined;
}): ReactElement {
  const [selected, setSelected] = useState<ReadonlyArray<string>>(initialIds);
  const errorId = useId();

  function toggle(id: string): void {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  return (
    <div>
      <span className="label-field">Tags</span>
      <div
        role="group"
        aria-describedby={error !== undefined ? errorId : undefined}
        className="flex flex-wrap gap-2"
      >
        {available.map((t) => {
          const active = selected.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              aria-pressed={active}
              className={`chip ${active ? 'chip-active' : ''}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {selected.map((id) => (
        <input key={id} type="hidden" name="tagIds" value={id} />
      ))}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function SoftwareField({
  initial,
  error,
}: {
  readonly initial: ReadonlyArray<string>;
  readonly error: string | undefined;
}): ReactElement {
  const [items, setItems] = useState<ReadonlyArray<string>>(initial);
  const [draft, setDraft] = useState('');
  const errorId = useId();

  function add(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || items.includes(trimmed)) {
      setDraft('');
      return;
    }
    setItems([...items, trimmed]);
    setDraft('');
  }

  function remove(value: string): void {
    setItems(items.filter((v) => v !== value));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && draft.length === 0 && items.length > 0) {
      const last = items[items.length - 1];
      if (last !== undefined) {
        remove(last);
      }
    }
  }

  return (
    <div>
      <label htmlFor="software-input" className="label-field">
        Software used
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
        id="software-input"
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder="Type a tool, press Enter…"
        maxLength={60}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className="input-field"
      />
      {items.map((value) => (
        <input key={value} type="hidden" name="softwareUsed" value={value} />
      ))}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function StatusField({
  initialStatus,
}: {
  readonly initialStatus: 'draft' | 'published';
}): ReactElement {
  const [status, setStatus] = useState<'draft' | 'published'>(initialStatus);
  return (
    <div>
      <span className="label-field">Status</span>
      <input type="hidden" name="status" value={status} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setStatus('draft')}
          aria-pressed={status === 'draft'}
          className={`chip ${status === 'draft' ? 'chip-active' : ''}`}
        >
          Draft
        </button>
        <button
          type="button"
          onClick={() => setStatus('published')}
          aria-pressed={status === 'published'}
          className={`chip ${status === 'published' ? 'chip-active' : ''}`}
        >
          Published
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Publishing requires a title, a cover image, and at least one media
        item with alt text.
      </p>
    </div>
  );
}

function FeaturedOrderField({
  initial,
  error,
}: {
  readonly initial: string;
  readonly error: string | undefined;
}): ReactElement {
  return (
    <div>
      <label htmlFor="featuredOrder" className="label-field">
        Featured order
      </label>
      <input
        id="featuredOrder"
        name="featuredOrder"
        type="number"
        min={0}
        max={11}
        defaultValue={initial}
        placeholder="Leave blank to skip"
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? 'featuredOrder-error' : undefined}
        className="input-field"
      />
      <p className="mt-1 text-xs text-muted">0–11. Lower numbers come first.</p>
      <FieldError id="featuredOrder-error" message={error} />
    </div>
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
      {pending ? 'Saving…' : 'Save project'}
    </button>
  );
}
