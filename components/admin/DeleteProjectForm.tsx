'use client';

/**
 * Confirmation-guarded delete button for the project editor.
 */

import { useFormStatus } from 'react-dom';
import type { ReactElement } from 'react';

import { deleteProject } from '@/app/admin/(protected)/projects/[id]/edit/actions';

export function DeleteProjectForm({
  projectId,
}: {
  readonly projectId: string;
}): ReactElement {
  return (
    <form
      action={deleteProject}
      onSubmit={(e) => {
        if (
          !confirm(
            'Permanently delete this project and every media item attached to it?',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={projectId} />
      <DeleteButton />
    </form>
  );
}

function DeleteButton(): ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-amber))] px-5 py-2 text-sm font-bold text-foreground"
    >
      {pending ? 'Deleting…' : 'Delete project'}
    </button>
  );
}
