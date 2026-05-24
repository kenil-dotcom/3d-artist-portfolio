'use client';

import { useFormStatus } from 'react-dom';
import type { ReactElement } from 'react';

import { uploadProfileImage } from '@/app/admin/(protected)/bio/actions';

export function BioImageUpload({
  currentUrl,
}: {
  readonly currentUrl: string | null;
}): ReactElement {
  return (
    <form
      action={uploadProfileImage}
      encType="multipart/form-data"
      className="flex flex-wrap items-center gap-4"
    >
      {currentUrl !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={currentUrl}
          alt="Current profile"
          className="h-24 w-24 rounded-full border-2 border-foreground object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="h-24 w-24 rounded-full border-2 border-foreground bg-surface"
        />
      )}
      <div className="flex-1 space-y-3">
        <input
          name="profileImage"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className="block w-full cursor-pointer rounded-2xl border-2 border-foreground bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-full file:border-2 file:border-foreground file:bg-[hsl(var(--color-pop-honey))] file:px-3 file:py-1 file:text-xs file:font-bold file:text-foreground"
        />
        <UploadButton label="Upload profile image" />
      </div>
    </form>
  );
}

function UploadButton({ label }: { readonly label: string }): ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="btn-primary px-4 py-2 text-xs"
    >
      {pending ? 'Uploading…' : label}
    </button>
  );
}
