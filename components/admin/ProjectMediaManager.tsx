'use client';

/**
 * ArtStation-style media manager for the project editor.
 *
 * Features:
 *   - Drop files anywhere in the editor to queue them for upload.
 *   - Direct-to-R2 uploads via presigned PUT URLs (XHR with progress).
 *   - YouTube/Vimeo embed input.
 *   - Drag-and-drop reorder backed by @dnd-kit.
 *   - Per-item alt-text/caption editing, cover selection, delete.
 *   - Live publish-readiness checklist.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
} from 'react';

import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import {
  addYouTubeEmbed,
  finalizeUpload,
  reorderMediaList,
  requestUploadUrl,
} from '@/app/admin/(protected)/projects/[id]/edit/upload-actions';
import {
  deleteMediaItem,
  publishProject,
  setCoverMedia,
  updateMediaItem,
} from '@/app/admin/(protected)/projects/[id]/edit/actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MediaItemView {
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly kind: 'image' | 'video' | 'model3d';
  readonly altText: string | null;
  readonly caption: string | null;
  readonly ordering: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly embedUrl: string | null;
}

interface ProjectMediaManagerProps {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly projectTitle: string;
  readonly status: 'draft' | 'scheduled' | 'published';
  readonly hasTitle: boolean;
  readonly hasSlug: boolean;
  readonly hasCategory: boolean;
  readonly initialMedia: ReadonlyArray<MediaItemView>;
  readonly initialCoverMediaId: string | null;
}

interface QueuedFile {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string | null;
  status: 'waiting' | 'uploading' | 'done' | 'error';
  progress: number;
  error: string | null;
  xhr: XMLHttpRequest | null;
}

const ACCEPTED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'model/gltf+json',
  'model/gltf-binary',
] as const;

const ACCEPTED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm', '.glb', '.gltf'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectMediaManager({
  projectId,
  projectSlug,
  projectTitle,
  status,
  hasTitle,
  hasSlug,
  hasCategory,
  initialMedia,
  initialCoverMediaId,
}: ProjectMediaManagerProps): ReactElement {
  const [items, setItems] = useState<ReadonlyArray<MediaItemView>>(initialMedia);
  const [coverId, setCoverId] = useState<string | null>(initialCoverMediaId);
  const [queue, setQueue] = useState<ReadonlyArray<QueuedFile>>([]);
  const [embedInput, setEmbedInput] = useState('');
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [embedPending, setEmbedPending] = useState(false);
  const [showEmbedPanel, setShowEmbedPanel] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queueRef = useRef<ReadonlyArray<QueuedFile>>(queue);
  queueRef.current = queue;

  // ---- Drag-and-drop file capture (page-level) -------------------------
  useEffect(() => {
    function onWindowDragOver(e: DragEvent | Event): void {
      const types = (e as DragEvent).dataTransfer?.types;
      if (types && Array.from(types).includes('Files')) {
        e.preventDefault();
      }
    }
    function onDrop(e: DragEvent | Event): void {
      const dt = (e as DragEvent).dataTransfer;
      if (!dt || dt.files.length === 0) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      addFiles(Array.from(dt.files));
    }
    function onDragEnter(e: DragEvent | Event): void {
      const types = (e as DragEvent).dataTransfer?.types;
      if (types && Array.from(types).includes('Files')) {
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      }
    }
    function onDragLeave(): void {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingFiles(false);
      }
    }
    window.addEventListener('dragover', onWindowDragOver as never);
    window.addEventListener('drop', onDrop as never);
    window.addEventListener('dragenter', onDragEnter as never);
    window.addEventListener('dragleave', onDragLeave as never);
    return () => {
      window.removeEventListener('dragover', onWindowDragOver as never);
      window.removeEventListener('drop', onDrop as never);
      window.removeEventListener('dragenter', onDragEnter as never);
      window.removeEventListener('dragleave', onDragLeave as never);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Queue helpers ---------------------------------------------------
  // Sequential uploader. Drains the queue one item at a time so concurrent
  // multi-GB uploads don't hammer R2 from a single tab.
  const runQueue = useCallback(async (): Promise<void> => {
    // Latest queue snapshot via ref.
    const pending = queueRef.current.find((q) => q.status === 'waiting');
    if (pending === undefined) return;
    if (queueRef.current.some((q) => q.status === 'uploading')) return;

    updateQueueItem(pending.id, { status: 'uploading', progress: 0 });
    try {
      const newItem = await uploadOne(pending);
      if (newItem !== null) {
        setItems((current) => [...current, newItem]);
        // Auto-pick a cover if one isn't set yet.
        setCoverId((current) => {
          if (current !== null) return current;
          if (newItem.kind === 'image') {
            void setCoverMediaSilent(projectId, newItem.id);
            return newItem.id;
          }
          return current;
        });
      }
      updateQueueItem(pending.id, { status: 'done', progress: 100 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateQueueItem(pending.id, { status: 'error', error: msg });
    }
    // Drain remaining items.
    setTimeout(() => {
      void runQueue();
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const addFiles = useCallback(
    (files: ReadonlyArray<File>): void => {
      const next: QueuedFile[] = [];
      for (const file of files) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`;
        const isImage = file.type.startsWith('image/');
        const previewUrl = isImage ? URL.createObjectURL(file) : null;
        next.push({
          id,
          file,
          previewUrl,
          status: 'waiting',
          progress: 0,
          error: null,
          xhr: null,
        });
      }
      if (next.length === 0) return;
      setQueue((current) => [...current, ...next]);
      void runQueue();
    },
    [runQueue],
  );

  function updateQueueItem(id: string, patch: Partial<QueuedFile>): void {
    setQueue((current) =>
      current.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    );
  }

  async function uploadOne(qf: QueuedFile): Promise<MediaItemView | null> {
    const presignResult = await requestUploadUrl(
      projectId,
      qf.file.name,
      qf.file.type || 'application/octet-stream',
      qf.file.size,
    );
    if (!presignResult.ok) {
      throw new Error(presignResult.error);
    }
    const { uploadUrl, publicUrl } = presignResult.value;

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', qf.file.type || 'application/octet-stream');
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          updateQueueItem(qf.id, { progress: percent });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`R2 upload failed (${xhr.status}).`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error while uploading to R2.'));
      xhr.onabort = () => reject(new Error('Upload cancelled.'));
      updateQueueItem(qf.id, { xhr });
      xhr.send(qf.file);
    });

    const finalize = await finalizeUpload(
      projectId,
      publicUrl,
      qf.file.type || 'application/octet-stream',
      qf.file.size,
      qf.file.name,
    );
    if (!finalize.ok) {
      throw new Error(finalize.error);
    }
    return finalize.value;
  }

  function cancelUpload(id: string): void {
    const target = queue.find((q) => q.id === id);
    if (target?.xhr !== null && target?.xhr !== undefined) {
      try {
        target.xhr.abort();
      } catch {
        // ignore
      }
    }
    setQueue((current) => current.filter((q) => q.id !== id));
  }

  function retryUpload(id: string): void {
    setQueue((current) =>
      current.map((q) =>
        q.id === id ? { ...q, status: 'waiting', error: null, progress: 0 } : q,
      ),
    );
    void runQueue();
  }

  function clearFinishedQueue(): void {
    setQueue((current) =>
      current.filter((q) => q.status !== 'done' && q.status !== 'error'),
    );
  }

  // ---- File input click handler ---------------------------------------
  function onFilesPicked(e: ChangeEvent<HTMLInputElement>): void {
    const files = e.target.files;
    if (files === null || files.length === 0) return;
    addFiles(Array.from(files));
    e.target.value = '';
  }

  // ---- Embed handler ---------------------------------------------------
  async function submitEmbed(): Promise<void> {
    setEmbedError(null);
    if (embedInput.trim().length === 0) {
      setEmbedError('Paste a YouTube or Vimeo URL.');
      return;
    }
    setEmbedPending(true);
    try {
      const result = await addYouTubeEmbed(projectId, embedInput.trim());
      if (!result.ok) {
        setEmbedError(result.error);
        return;
      }
      setItems((current) => [...current, result.value]);
      setEmbedInput('');
      setShowEmbedPanel(false);
    } finally {
      setEmbedPending(false);
    }
  }

  // ---- Drag-and-drop reorder ------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEndItems(event: DragEndEvent): Promise<void> {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove([...items], oldIndex, newIndex);
    setItems(next);
    setReorderError(null);
    const ids = next.map((i) => i.id);
    const result = await reorderMediaList(projectId, ids);
    if (!result.ok) {
      setReorderError(result.error);
      // Revert on failure.
      setItems(items);
    }
  }

  // ---- Per-item handlers ----------------------------------------------
  async function handleSetCover(mediaId: string): Promise<void> {
    setCoverId(mediaId);
    await setCoverMediaSilent(projectId, mediaId);
  }

  async function handleSaveMetadata(
    mediaId: string,
    altText: string,
    caption: string,
  ): Promise<void> {
    const fd = new FormData();
    fd.set('id', mediaId);
    fd.set('altText', altText);
    fd.set('caption', caption);
    await updateMediaItem(fd);
    setItems((current) =>
      current.map((i) =>
        i.id === mediaId
          ? {
              ...i,
              altText: altText.length === 0 ? null : altText,
              caption: caption.length === 0 ? null : caption,
            }
          : i,
      ),
    );
  }

  async function handleDelete(mediaId: string): Promise<void> {
    if (!confirm('Delete this media item?')) return;
    const fd = new FormData();
    fd.set('id', mediaId);
    await deleteMediaItem(fd);
    setItems((current) => current.filter((i) => i.id !== mediaId));
    setCoverId((current) => (current === mediaId ? null : current));
  }

  // ---- Publish-readiness check ----------------------------------------
  const checklist = useMemo(() => buildChecklist({
    hasTitle,
    hasSlug,
    hasCategory,
    coverId,
    items,
  }), [hasTitle, hasSlug, hasCategory, coverId, items]);

  const allGreen = checklist.every((c) => c.met);

  async function handlePublish(): Promise<void> {
    if (!allGreen) return;
    const fd = new FormData();
    fd.set('projectId', projectId);
    await publishProject(fd);
    // Optimistically update the UI; the page revalidates in the background.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  function handleCopyPublicLink(): void {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/projects/${projectSlug}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopyState('copied');
        setTimeout(() => setCopyState('idle'), 1500);
      },
      () => {
        setCopyState('idle');
      },
    );
  }

  // ---- Cover preview --------------------------------------------------
  const coverItem = useMemo(
    () => items.find((i) => i.id === coverId) ?? null,
    [items, coverId],
  );

  // ---- Render ----------------------------------------------------------
  return (
    <div className="space-y-6">
      <PublishCallout
        status={status}
        slug={projectSlug}
        checklist={checklist}
        allGreen={allGreen}
        onPublish={handlePublish}
        onCopyLink={handleCopyPublicLink}
        copyState={copyState}
      />

      <CoverPreview coverItem={coverItem} title={projectTitle} />

      <div className="flex flex-wrap items-center justify-end gap-3">
        <a
          href={`/projects/${projectSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          data-cursor-label="Preview"
          className="btn-secondary px-5 py-2 text-xs"
        >
          Preview public page →
        </a>
      </div>

      <DropZone
        isDraggingFiles={isDraggingFiles}
        onPickClick={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={[...ACCEPTED_MIME, ...ACCEPTED_EXTS].join(',')}
        onChange={onFilesPicked}
        className="hidden"
      />

      <UploadQueue
        queue={queue}
        onCancel={cancelUpload}
        onRetry={retryUpload}
        onClearFinished={clearFinishedQueue}
      />

      <EmbedPanel
        show={showEmbedPanel}
        toggle={() => setShowEmbedPanel((s) => !s)}
        value={embedInput}
        onChange={setEmbedInput}
        onSubmit={submitEmbed}
        error={embedError}
        pending={embedPending}
      />

      {reorderError !== null ? (
        <p
          role="alert"
          className="rounded-2xl border-2 border-foreground bg-[hsl(var(--color-pop-amber)/0.3)] px-4 py-3 text-sm font-medium text-foreground"
        >
          {reorderError}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-foreground/30 bg-surface px-4 py-12 text-center text-sm text-muted">
          No media yet. Drop files above or paste a YouTube link to get started.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEndItems}
        >
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul role="list" className="space-y-3">
              {items.map((item) => (
                <SortableMediaRow
                  key={item.id}
                  item={item}
                  isCover={coverId === item.id}
                  onSetCover={handleSetCover}
                  onSaveMetadata={handleSaveMetadata}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface ChecklistEntry {
  readonly id: string;
  readonly label: string;
  readonly met: boolean;
  readonly anchor: string;
}

function buildChecklist(args: {
  readonly hasTitle: boolean;
  readonly hasSlug: boolean;
  readonly hasCategory: boolean;
  readonly coverId: string | null;
  readonly items: ReadonlyArray<MediaItemView>;
}): ReadonlyArray<ChecklistEntry> {
  const { hasTitle, hasSlug, hasCategory, coverId, items } = args;
  const checklist: ChecklistEntry[] = [
    { id: 'title', label: 'Title set', met: hasTitle, anchor: 'title' },
    { id: 'slug', label: 'Slug set', met: hasSlug, anchor: 'slug' },
    { id: 'category', label: 'Category chosen', met: hasCategory, anchor: 'categoryId' },
    { id: 'cover', label: 'Cover image set', met: coverId !== null, anchor: 'coverMediaId' },
    {
      id: 'media',
      label: 'At least one media item',
      met: items.length > 0,
      anchor: 'media-heading',
    },
  ];
  const imagesWithoutAlt = items.filter(
    (i) => i.kind === 'image' && (i.altText === null || i.altText.trim().length === 0),
  );
  checklist.push({
    id: 'alt',
    label:
      imagesWithoutAlt.length === 0
        ? 'Every image has alt text'
        : `${imagesWithoutAlt.length} image(s) missing alt text`,
    met: imagesWithoutAlt.length === 0,
    anchor: 'media-heading',
  });
  return checklist;
}

function PublishCallout({
  status,
  slug,
  checklist,
  allGreen,
  onPublish,
  onCopyLink,
  copyState,
}: {
  readonly status: 'draft' | 'scheduled' | 'published';
  readonly slug: string;
  readonly checklist: ReadonlyArray<ChecklistEntry>;
  readonly allGreen: boolean;
  readonly onPublish: () => void;
  readonly onCopyLink: () => void;
  readonly copyState: 'idle' | 'copied';
}): ReactElement {
  if (status === 'published' && allGreen) {
    return (
      <div className="surface-card flex flex-wrap items-center justify-between gap-4 border-[hsl(var(--color-pop-sage))] bg-[hsl(var(--color-pop-sage)/0.25)] p-5 shadow-[6px_6px_0_0_hsl(var(--color-pop-sage))]">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">
            Live
          </p>
          <p className="mt-1 text-sm font-medium">
            Published at{' '}
            <a
              href={`/projects/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              /projects/{slug}
            </a>
          </p>
        </div>
        <button
          type="button"
          onClick={onCopyLink}
          className="btn-secondary px-4 py-2 text-xs"
        >
          {copyState === 'copied' ? '✓ Link copied' : 'Copy public link'}
        </button>
      </div>
    );
  }

  if (allGreen) {
    return (
      <div className="surface-card flex flex-wrap items-center justify-between gap-4 border-[hsl(var(--color-pop-sage))] bg-[hsl(var(--color-pop-sage)/0.25)] p-5 shadow-[6px_6px_0_0_hsl(var(--color-pop-sage))]">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">
            Ready to publish
          </p>
          <p className="mt-1 text-sm">
            All publish-readiness checks pass. One click and this project goes live.
          </p>
        </div>
        <button
          type="button"
          onClick={onPublish}
          data-cursor-label="Publish"
          className="btn-primary px-5 py-2 text-xs"
        >
          Publish project
        </button>
      </div>
    );
  }

  return (
    <div className="surface-card border-[hsl(var(--color-pop-amber))] bg-[hsl(var(--color-pop-amber)/0.18)] p-5 shadow-[6px_6px_0_0_hsl(var(--color-pop-amber))]">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">
        Almost there
      </p>
      <p className="mt-1 text-sm">
        Finish the items below and the publish button will unlock.
      </p>
      <ul role="list" className="mt-4 space-y-2 text-sm">
        {checklist.map((entry) => (
          <li key={entry.id} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-foreground text-[10px] font-bold ${
                entry.met
                  ? 'bg-[hsl(var(--color-pop-sage))] text-foreground'
                  : 'bg-background text-foreground'
              }`}
            >
              {entry.met ? '✓' : ''}
            </span>
            {entry.met ? (
              <span className="text-foreground">{entry.label}</span>
            ) : (
              <a
                href={`#${entry.anchor}`}
                className="text-foreground underline decoration-[hsl(var(--color-pop-amber))] decoration-2 underline-offset-2 hover:text-foreground"
              >
                {entry.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CoverPreview({
  coverItem,
  title,
}: {
  readonly coverItem: MediaItemView | null;
  readonly title: string;
}): ReactElement {
  return (
    <div className="surface-card p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">
        Gallery preview
      </p>
      <p className="mt-1 text-xs text-muted">
        How this project shows up on the gallery grid.
      </p>
      <div className="mt-4 max-w-xs">
        <div className="overflow-hidden rounded-3xl border-2 border-foreground bg-background shadow-[6px_6px_0_0_hsl(var(--color-pop-honey))]">
          <div className="aspect-[4/3] w-full overflow-hidden bg-surface">
            {coverItem === null ? (
              <div
                aria-hidden="true"
                className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface via-background to-surface text-xs text-muted"
              >
                Pick a cover to preview
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverItem.storageKey}
                alt={coverItem.altText ?? `${title} cover`}
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <div className="px-4 py-3">
            <p className="text-sm font-normal text-foreground">{title || 'Untitled'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DropZone({
  isDraggingFiles,
  onPickClick,
}: {
  readonly isDraggingFiles: boolean;
  readonly onPickClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onPickClick}
      data-cursor-label="Upload"
      className={`block w-full rounded-3xl border-2 border-dashed bg-surface px-6 py-12 text-center transition-all ease-soft ${
        isDraggingFiles
          ? 'scale-[1.01] border-[hsl(var(--color-pop-honey))] bg-[hsl(var(--color-pop-honey)/0.25)]'
          : 'border-foreground/40 hover:border-foreground'
      }`}
    >
      <p className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]">
        Drop files anywhere
      </p>
      <p className="mt-2 text-sm text-muted">
        or <span className="underline">click to choose</span> from your computer
      </p>
      <p className="mt-4 text-[10px] uppercase tracking-[0.18em] text-muted">
        JPEG · PNG · WebP · MP4 · WebM · glTF · GLB · up to 5 GB
      </p>
    </button>
  );
}

function UploadQueue({
  queue,
  onCancel,
  onRetry,
  onClearFinished,
}: {
  readonly queue: ReadonlyArray<QueuedFile>;
  readonly onCancel: (id: string) => void;
  readonly onRetry: (id: string) => void;
  readonly onClearFinished: () => void;
}): ReactElement | null {
  if (queue.length === 0) return null;
  const hasFinished = queue.some((q) => q.status === 'done' || q.status === 'error');

  return (
    <div className="surface-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">
          Upload queue · {queue.length}
        </p>
        {hasFinished ? (
          <button
            type="button"
            onClick={onClearFinished}
            className="text-xs text-muted underline hover:text-foreground"
          >
            Clear finished
          </button>
        ) : null}
      </div>
      <ul role="list" className="mt-3 space-y-2">
        {queue.map((q) => (
          <li
            key={q.id}
            className="flex items-center gap-3 rounded-2xl border-2 border-foreground bg-background p-3"
          >
            <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg border-2 border-foreground bg-surface">
              {q.previewUrl !== null ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={q.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-muted">
                  {q.file.type.startsWith('video/') ? '▶ video' : '◇ file'}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium text-foreground">
                  {q.file.name}
                </p>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-muted">
                  {formatBytes(q.file.size)}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full border-2 border-foreground bg-background">
                <div
                  className={`h-full transition-all ease-soft ${
                    q.status === 'error'
                      ? 'bg-[hsl(var(--color-pop-amber))]'
                      : q.status === 'done'
                        ? 'bg-[hsl(var(--color-pop-sage))]'
                        : 'bg-[hsl(var(--color-pop-honey))]'
                  }`}
                  style={{ width: `${q.status === 'done' ? 100 : q.progress}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted">
                {statusLabel(q)}
              </p>
              {q.status === 'error' && q.error !== null ? (
                <p className="mt-1 text-xs text-foreground">{q.error}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              {q.status === 'error' ? (
                <button
                  type="button"
                  onClick={() => onRetry(q.id)}
                  className="rounded-full border-2 border-foreground bg-background px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]"
                >
                  Retry
                </button>
              ) : null}
              {q.status !== 'done' ? (
                <button
                  type="button"
                  onClick={() => onCancel(q.id)}
                  className="rounded-full border-2 border-foreground bg-background px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]"
                >
                  {q.status === 'uploading' ? 'Cancel' : 'Remove'}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function statusLabel(q: QueuedFile): string {
  if (q.status === 'waiting') return 'Waiting';
  if (q.status === 'uploading') return `Uploading · ${q.progress}%`;
  if (q.status === 'done') return 'Done';
  return 'Failed';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function EmbedPanel({
  show,
  toggle,
  value,
  onChange,
  onSubmit,
  error,
  pending,
}: {
  readonly show: boolean;
  readonly toggle: () => void;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly onSubmit: () => void;
  readonly error: string | null;
  readonly pending: boolean;
}): ReactElement {
  return (
    <div className="surface-card p-4">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">
          + Add video link
        </span>
        <span className="text-xs text-muted">
          {show ? 'Hide' : 'YouTube · Vimeo'}
        </span>
      </button>
      {show ? (
        <div className="mt-4 space-y-3">
          <input
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://youtu.be/... or https://vimeo.com/..."
            className="input-field"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              The link is embedded as an iframe with no bytes uploaded.
            </p>
            <button
              type="button"
              onClick={onSubmit}
              disabled={pending}
              aria-busy={pending}
              className="btn-primary px-5 py-2 text-xs"
            >
              {pending ? 'Adding…' : 'Add'}
            </button>
          </div>
          {error !== null ? (
            <p
              role="alert"
              className="rounded-xl border-2 border-foreground bg-[hsl(var(--color-pop-amber)/0.3)] px-3 py-2 text-xs"
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SortableMediaRow({
  item,
  isCover,
  onSetCover,
  onSaveMetadata,
  onDelete,
}: {
  readonly item: MediaItemView;
  readonly isCover: boolean;
  readonly onSetCover: (id: string) => void;
  readonly onSaveMetadata: (
    id: string,
    altText: string,
    caption: string,
  ) => Promise<void>;
  readonly onDelete: (id: string) => void;
}): ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [altText, setAltText] = useState(item.altText ?? '');
  const [caption, setCaption] = useState(item.caption ?? '');
  const [saving, setSaving] = useState(false);

  // Sync local state if the parent updates the row.
  useEffect(() => {
    setAltText(item.altText ?? '');
    setCaption(item.caption ?? '');
  }, [item.altText, item.caption]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    boxShadow: isDragging ? '6px 6px 0 0 hsl(var(--color-pop-honey))' : undefined,
  };

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await onSaveMetadata(item.id, altText.trim(), caption.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="grid items-center gap-3 rounded-2xl border-2 border-foreground bg-background p-3 md:grid-cols-[auto_120px_1fr_auto]"
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="flex h-10 w-6 cursor-grab items-center justify-center rounded-md text-foreground/60 hover:bg-surface active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true" className="text-xl leading-none">⋮⋮</span>
      </button>
      <Thumbnail item={item} isCover={isCover} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border-2 border-foreground bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground">
            {item.embedUrl !== null ? 'embed' : item.kind}
          </span>
          {item.embedUrl !== null ? (
            <span className="rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-honey))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground">
              {item.embedUrl.includes('youtube') ? 'YouTube' : 'Vimeo'}
            </span>
          ) : null}
          <span className="truncate text-xs text-muted">{item.mimeType}</span>
        </div>
        {editing ? (
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder={
                item.kind === 'image' ? 'Describe the image (alt text)' : 'Optional alt text'
              }
              maxLength={500}
              className="input-field py-2 text-sm"
            />
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption (optional)"
              maxLength={200}
              className="input-field py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="btn-primary px-4 py-1.5 text-xs"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="btn-secondary px-4 py-1.5 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 truncate text-sm font-medium text-foreground">
              {item.altText === null || item.altText.length === 0
                ? item.kind === 'image'
                  ? 'No alt text yet — add one before publishing'
                  : 'No alt text'
                : item.altText}
            </p>
            {item.caption !== null && item.caption.length > 0 ? (
              <p className="text-xs italic text-muted">{item.caption}</p>
            ) : null}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {item.kind === 'image' ? (
          <button
            type="button"
            onClick={() => onSetCover(item.id)}
            aria-pressed={isCover}
            className={`rounded-full border-2 border-foreground px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
              isCover
                ? 'bg-[hsl(var(--color-pop-honey))] text-foreground'
                : 'bg-background text-foreground hover:bg-surface'
            }`}
          >
            {isCover ? '★ Cover' : 'Set cover'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setEditing((s) => !s)}
          className="rounded-full border-2 border-foreground bg-background px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] hover:bg-surface"
        >
          {editing ? 'Close' : 'Edit'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-amber))] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function Thumbnail({
  item,
  isCover,
}: {
  readonly item: MediaItemView;
  readonly isCover: boolean;
}): ReactElement {
  if (item.embedUrl !== null) {
    return (
      <div className="relative h-16 w-28 overflow-hidden rounded-xl border-2 border-foreground bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.storageKey}
          alt=""
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-foreground/80"
        >
          ▶
        </span>
      </div>
    );
  }
  if (item.kind === 'image') {
    return (
      <div className="relative h-16 w-28 overflow-hidden rounded-xl border-2 border-foreground bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.storageKey}
          alt={item.altText ?? ''}
          className="h-full w-full object-cover"
        />
        {isCover ? (
          <span className="absolute left-1 top-1 rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-honey))] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-foreground">
            ★
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex h-16 w-28 items-center justify-center rounded-xl border-2 border-foreground bg-surface text-xs font-semibold text-muted">
      {item.kind === 'video' ? '▶ Video' : '◇ Model'}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setCoverMediaSilent(
  projectId: string,
  mediaId: string,
): Promise<void> {
  const fd = new FormData();
  fd.set('projectId', projectId);
  fd.set('mediaId', mediaId);
  await setCoverMedia(fd);
}
