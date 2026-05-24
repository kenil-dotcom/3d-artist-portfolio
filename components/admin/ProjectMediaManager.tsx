'use client';

/**
 * Media manager for a single project.
 *
 * Renders the existing media items with edit-in-place alt + caption
 * forms, up/down reorder buttons, and a delete confirmation. A separate
 * upload form below the list accepts multiple files and uses
 * `useFormState` to surface success / partial-rejection messages
 * from the server action.
 */

import { useFormState, useFormStatus } from 'react-dom';
import { useMemo, type ReactElement } from 'react';

import {
  uploadMedia,
  updateMediaItem,
  deleteMediaItem,
  moveMediaItem,
  INITIAL_UPLOAD_STATE,
  type UploadMediaState,
} from '@/app/admin/(protected)/projects/[id]/edit/actions';

interface MediaItemView {
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly kind: 'image' | 'video' | 'model3d';
  readonly altText: string | null;
  readonly caption: string | null;
  readonly ordering: number;
  readonly width: number | null;
  readonly height: number | null;
}

interface ProjectMediaManagerProps {
  readonly projectId: string;
  readonly mediaItems: ReadonlyArray<MediaItemView>;
}

export function ProjectMediaManager({
  projectId,
  mediaItems,
}: ProjectMediaManagerProps): ReactElement {
  const boundUpload = useMemo(
    () => uploadMedia.bind(null, projectId),
    [projectId],
  );
  const [uploadState, uploadAction] = useFormState<UploadMediaState, FormData>(
    boundUpload,
    INITIAL_UPLOAD_STATE,
  );

  return (
    <div className="space-y-6">
      <UploadFormBlock action={uploadAction} state={uploadState} />

      {mediaItems.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-foreground/30 px-4 py-8 text-center text-sm text-muted">
          No media yet. Upload an image to get started.
        </p>
      ) : (
        <ul role="list" className="space-y-4">
          {mediaItems.map((item, index) => (
            <li key={item.id}>
              <MediaRow
                item={item}
                isFirst={index === 0}
                isLast={index === mediaItems.length - 1}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadFormBlock({
  action,
  state,
}: {
  readonly action: (formData: FormData) => void;
  readonly state: UploadMediaState;
}): ReactElement {
  return (
    <form
      action={action}
      encType="multipart/form-data"
      className="rounded-2xl border-2 border-dashed border-foreground/40 bg-surface px-4 py-5"
    >
      <label htmlFor="media-files" className="label-field">
        Upload media
      </label>
      <input
        id="media-files"
        name="files"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,model/gltf+json,model/gltf-binary,.glb,.gltf"
        className="block w-full cursor-pointer rounded-2xl border-2 border-foreground bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-full file:border-2 file:border-foreground file:bg-[hsl(var(--color-pop-honey))] file:px-3 file:py-1 file:text-xs file:font-bold file:text-foreground"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          JPEG/PNG/WebP, MP4/WebM, or glTF/GLB. Max 100 MB per file.
        </p>
        <UploadButton />
      </div>
      {state.message !== null ? (
        <p
          role={state.status === 'error' ? 'alert' : 'status'}
          className={`mt-3 rounded-xl border-2 border-foreground px-3 py-2 text-xs ${
            state.status === 'error'
              ? 'bg-[hsl(var(--color-pop-amber)/0.3)]'
              : 'bg-[hsl(var(--color-pop-sage)/0.4)]'
          }`}
        >
          {state.message}
        </p>
      ) : null}
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
      className="btn-primary px-5 py-2 text-xs"
    >
      {pending ? 'Uploading…' : 'Upload'}
    </button>
  );
}

function MediaRow({
  item,
  isFirst,
  isLast,
}: {
  readonly item: MediaItemView;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}): ReactElement {
  return (
    <div className="grid gap-4 rounded-2xl border-2 border-foreground bg-background p-4 md:grid-cols-[140px_1fr_auto]">
      <div className="flex items-center justify-center">
        <Thumbnail item={item} />
      </div>

      <form action={updateMediaItem} className="space-y-3">
        <input type="hidden" name="id" value={item.id} />
        <div className="flex items-center gap-2">
          <span className="rounded-full border-2 border-foreground bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground">
            {item.kind}
          </span>
          <span className="text-xs text-muted">{item.mimeType}</span>
        </div>
        <div>
          <label
            htmlFor={`alt-${item.id}`}
            className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground"
          >
            Alt text
          </label>
          <input
            id={`alt-${item.id}`}
            name="altText"
            type="text"
            maxLength={500}
            defaultValue={item.altText ?? ''}
            placeholder={item.kind === 'image' ? 'Describe the image' : 'Optional'}
            className="input-field py-2 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor={`cap-${item.id}`}
            className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground"
          >
            Caption
          </label>
          <input
            id={`cap-${item.id}`}
            name="caption"
            type="text"
            maxLength={200}
            defaultValue={item.caption ?? ''}
            className="input-field py-2 text-sm"
          />
        </div>
        <button type="submit" className="btn-secondary px-4 py-1.5 text-xs">
          Save metadata
        </button>
      </form>

      <div className="flex flex-row items-start justify-end gap-2 md:flex-col md:items-stretch">
        <form action={moveMediaItem}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="direction" value="up" />
          <button
            type="submit"
            disabled={isFirst}
            className="btn-secondary w-full px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            ↑ Up
          </button>
        </form>
        <form action={moveMediaItem}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="direction" value="down" />
          <button
            type="submit"
            disabled={isLast}
            className="btn-secondary w-full px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            ↓ Down
          </button>
        </form>
        <DeleteMediaForm id={item.id} />
      </div>
    </div>
  );
}

function DeleteMediaForm({ id }: { readonly id: string }): ReactElement {
  return (
    <form
      action={deleteMediaItem}
      onSubmit={(e) => {
        if (!confirm('Delete this media item? The file on disk is not removed.')) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="w-full rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-amber))] px-3 py-1.5 text-xs font-bold text-foreground"
      >
        Delete
      </button>
    </form>
  );
}

function Thumbnail({ item }: { readonly item: MediaItemView }): ReactElement {
  if (item.kind === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.storageKey}
        alt={item.altText ?? ''}
        className="h-24 w-32 rounded-xl border-2 border-foreground object-cover"
      />
    );
  }
  return (
    <div className="flex h-24 w-32 items-center justify-center rounded-xl border-2 border-foreground bg-surface text-xs font-semibold text-muted">
      {item.kind === 'video' ? '▶ Video' : '◇ Model'}
    </div>
  );
}
