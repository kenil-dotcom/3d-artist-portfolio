'use client';

/**
 * Minimal new-project form.
 *
 * Once saved, the user is redirected to the full editor where they can
 * add tags, software, media, and publish.
 */

import { useFormState, useFormStatus } from 'react-dom';
import { useEffect, useState, type ReactElement } from 'react';

import {
  createProject,
  INITIAL_CREATE_STATE,
  type CreateProjectState,
} from '@/app/admin/(protected)/projects/new/actions';
import { slugify } from '@/lib/admin/slug';

interface NewProjectFormProps {
  readonly categories: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export function NewProjectForm({
  categories,
}: NewProjectFormProps): ReactElement {
  const [state, formAction] = useFormState<CreateProjectState, FormData>(
    createProject,
    INITIAL_CREATE_STATE,
  );

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [autoSlug, setAutoSlug] = useState(true);

  useEffect(() => {
    if (autoSlug) {
      setSlug(slugify(title));
    }
  }, [title, autoSlug]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      action={formAction}
      className="surface-card space-y-6 p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-caramel))]"
    >
      {state.status === 'error' && state.message !== null ? (
        <p
          role="alert"
          className="rounded-2xl border-2 border-foreground bg-[hsl(var(--color-pop-amber)/0.3)] px-4 py-3 text-sm font-medium text-foreground"
        >
          {state.message}
        </p>
      ) : null}

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
          aria-invalid={state.errors['title'] !== undefined}
          aria-describedby={
            state.errors['title'] !== undefined ? 'title-error' : undefined
          }
          className="input-field"
        />
        {state.errors['title'] !== undefined ? (
          <p
            id="title-error"
            className="mt-2 text-xs font-medium text-[hsl(var(--color-pop-amber))]"
          >
            {state.errors['title']}
          </p>
        ) : null}
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
          aria-invalid={state.errors['slug'] !== undefined}
          aria-describedby={
            state.errors['slug'] !== undefined ? 'slug-error' : undefined
          }
          className="input-field"
        />
        {state.errors['slug'] !== undefined ? (
          <p
            id="slug-error"
            className="mt-2 text-xs font-medium text-[hsl(var(--color-pop-amber))]"
          >
            {state.errors['slug']}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="description" className="label-field">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={5000}
          className="input-field resize-y"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="categoryId" className="label-field">
            Category
          </label>
          <select
            id="categoryId"
            name="categoryId"
            required
            defaultValue=""
            aria-invalid={state.errors['categoryId'] !== undefined}
            aria-describedby={
              state.errors['categoryId'] !== undefined ? 'category-error' : undefined
            }
            className="input-field"
          >
            <option value="">Choose a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {state.errors['categoryId'] !== undefined ? (
            <p
              id="category-error"
              className="mt-2 text-xs font-medium text-[hsl(var(--color-pop-amber))]"
            >
              {state.errors['categoryId']}
            </p>
          ) : null}
        </div>
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
            defaultValue={today}
            aria-invalid={state.errors['creationDate'] !== undefined}
            aria-describedby={
              state.errors['creationDate'] !== undefined
                ? 'creation-error'
                : undefined
            }
            className="input-field"
          />
          {state.errors['creationDate'] !== undefined ? (
            <p
              id="creation-error"
              className="mt-2 text-xs font-medium text-[hsl(var(--color-pop-amber))]"
            >
              {state.errors['creationDate']}
            </p>
          ) : null}
        </div>
      </div>

      <SubmitButton />
    </form>
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
      {pending ? 'Creating…' : 'Create draft'}
    </button>
  );
}
