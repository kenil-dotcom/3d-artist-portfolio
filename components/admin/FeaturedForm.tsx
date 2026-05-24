'use client';

/**
 * Featured set editor form.
 *
 * Lists every published project with a checkbox + numeric order input.
 * The form action persists the (id, order) tuple set and clears any
 * project that wasn't included.
 */

import { useFormState, useFormStatus } from 'react-dom';
import { useState, type ReactElement } from 'react';

import {
  INITIAL_FEATURED_STATE,
  saveFeatured,
  type SaveFeaturedState,
} from '@/app/admin/(protected)/featured/actions';

interface ProjectRow {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly currentOrder: number | null;
}

interface FeaturedFormProps {
  readonly projects: ReadonlyArray<ProjectRow>;
}

export function FeaturedForm({ projects }: FeaturedFormProps): ReactElement {
  const [state, formAction] = useFormState<SaveFeaturedState, FormData>(
    saveFeatured,
    INITIAL_FEATURED_STATE,
  );

  // Local state to drive checkbox <-> order input enablement so the admin
  // can untick a project and have its order field clear.
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const p of projects) {
      initial[p.id] = p.currentOrder !== null;
    }
    return initial;
  });

  function toggle(id: string): void {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  return (
    <form action={formAction} className="space-y-6">
      {state.status === 'success' && state.message !== null ? (
        <p
          role="status"
          className="rounded-2xl border-2 border-foreground bg-[hsl(var(--color-pop-sage)/0.4)] px-4 py-3 text-sm font-medium text-foreground"
        >
          {state.message}
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

      {projects.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-foreground/30 px-4 py-8 text-center text-sm text-muted">
          Publish at least one project to feature it on the landing page.
        </p>
      ) : (
        <ul role="list" className="space-y-2">
          {projects.map((p) => {
            const checked = selected[p.id] === true;
            const orderId = `order-${p.id}`;
            return (
              <li
                key={p.id}
                className="grid grid-cols-[auto_1fr_120px] items-center gap-4 rounded-2xl border-2 border-foreground bg-background px-4 py-3"
              >
                <input
                  type="checkbox"
                  name="featured"
                  value={p.id}
                  checked={checked}
                  onChange={() => toggle(p.id)}
                  aria-label={`Feature ${p.title}`}
                  className="h-5 w-5 cursor-pointer"
                />
                <div>
                  <p className="font-semibold text-foreground">{p.title}</p>
                  <p className="text-xs text-muted">/{p.slug}</p>
                </div>
                <div>
                  <label htmlFor={orderId} className="sr-only">
                    Order for {p.title}
                  </label>
                  <input
                    id={orderId}
                    name={`order:${p.id}`}
                    type="number"
                    min={0}
                    max={11}
                    defaultValue={p.currentOrder ?? ''}
                    placeholder="—"
                    disabled={!checked}
                    className="input-field py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
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
      {pending ? 'Saving…' : 'Save featured set'}
    </button>
  );
}
