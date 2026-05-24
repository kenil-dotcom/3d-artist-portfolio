'use client';

import { useFormStatus } from 'react-dom';
import type { ReactElement } from 'react';

import { uploadResume } from '@/app/admin/(protected)/bio/actions';

export function BioResumeUpload({
  currentUrl,
}: {
  readonly currentUrl: string | null;
}): ReactElement {
  return (
    <form
      action={uploadResume}
      encType="multipart/form-data"
      className="space-y-3"
    >
      {currentUrl !== null ? (
        <p className="text-sm text-muted">
          Current resume:{' '}
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-foreground underline"
          >
            View PDF →
          </a>
        </p>
      ) : (
        <p className="text-sm text-muted">No resume uploaded yet.</p>
      )}
      <input
        name="resume"
        type="file"
        accept="application/pdf,.pdf"
        required
        className="block w-full cursor-pointer rounded-2xl border-2 border-foreground bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-full file:border-2 file:border-foreground file:bg-[hsl(var(--color-pop-honey))] file:px-3 file:py-1 file:text-xs file:font-bold file:text-foreground"
      />
      <UploadButton />
    </form>
  );
}

function UploadButton(): ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="btn-primary px-4 py-2 text-xs"
    >
      {pending ? 'Uploading…' : 'Upload resume'}
    </button>
  );
}
