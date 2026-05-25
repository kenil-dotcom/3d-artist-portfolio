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
  replaceMediaFile,
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
  /**
   * `permanently_failed` is reached after MAX_UPLOAD_ATTEMPTS unsuccessful
   * tries. Once a file is in that state the "Retry" affordance is hidden and
   * the final failure reason is retained next to the row; no Media_Item row
   * is ever created for it (Requirement 13.4 / 13.5).
   */
  status: 'waiting' | 'uploading' | 'done' | 'error' | 'permanently_failed';
  progress: number;
  error: string | null;
  xhr: XMLHttpRequest | null;
  /**
   * Number of upload attempts that have been started for this file (initial
   * plus retries). Capped by MAX_UPLOAD_ATTEMPTS = 3. Counted at the moment
   * the file transitions from `waiting` -> `uploading`, so a file in `error`
   * state already has its attempt for that try recorded.
   */
  attemptCount: number;
}

/**
 * Maximum number of times a queued file may be uploaded before it is marked
 * `permanently_failed`. Three matches the Requirement 13.4 budget (initial
 * plus two retries).
 */
const MAX_UPLOAD_ATTEMPTS = 3;

/**
 * Tick interval (ms) used to nudge React into re-rendering the per-file
 * progress bar even when the network goes quiet between XHR `progress`
 * events. Requirement 13.7 demands the displayed integer percentage refresh
 * at least every 500 ms while a file is in `uploading` status.
 */
const PROGRESS_TICK_MS = 500;

/**
 * Maximum tolerated wall-clock duration of a synchronous `xhr.abort()` call.
 * `XMLHttpRequest.abort()` is synchronous in every supported browser, so the
 * elapsed time is expected to be well under this bound; if it exceeds the
 * bound we log a warning so a regression in the cancel path becomes visible
 * (Requirement 13.6).
 */
const ABORT_BUDGET_MS = 1000;

/**
 * Per-row replacement state for the "Replace file" affordance. Stored
 * separately from the global upload `queue` so the per-row progress UI
 * does not collide with the multi-file uploader. The map is keyed by
 * `mediaId` (the existing Media_Item being replaced); the `QueuedFile`
 * shape is reused so we share progress / status rendering helpers.
 */
type ReplaceState = QueuedFile;

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
  const [replaceStates, setReplaceStates] = useState<
    ReadonlyMap<string, ReplaceState>
  >(() => new Map());
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

  // ---- Reorder debounce + abort-timeout machinery -----------------------
  // The reorder submission is debounced by 500 ms after the last drop, so a
  // burst of drag-and-drop adjustments collapses into a single network round
  // trip. The in-flight submission is wrapped in an AbortController with a
  // 10-second client-side ceiling.
  //
  // Caveat: server actions in Next.js are not natively cancellable via
  // `AbortSignal` (the runtime does not propagate the signal to the server).
  // The AbortController is therefore used purely as a client-side "give up"
  // signal: on timeout or supersedence we revert local state and ignore the
  // eventual server response. The server action may still commit the
  // already-started write; the user sees the revert + error and can re-drop.
  // The same envelope (500 ms debounce, 10 s timeout, snapshot revert) will
  // be applied to `components/admin/ProjectSectionEditor.tsx` when task 6.3
  // lands so both reorder surfaces share the timing contract.
  const reorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reorderAbortRef = useRef<AbortController | null>(null);
  const reorderSnapshotRef = useRef<ReadonlyArray<MediaItemView> | null>(null);
  const itemsRef = useRef<ReadonlyArray<MediaItemView>>(items);
  itemsRef.current = items;

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

  // ---- Cleanup pending reorder timers / aborts on unmount --------------
  useEffect(() => {
    return () => {
      if (reorderTimerRef.current !== null) {
        clearTimeout(reorderTimerRef.current);
        reorderTimerRef.current = null;
      }
      if (reorderAbortRef.current !== null) {
        reorderAbortRef.current.abort();
        reorderAbortRef.current = null;
      }
    };
  }, []);

  // ---- Queue helpers ---------------------------------------------------
  // Sequential uploader. Drains the queue one item at a time so concurrent
  // multi-GB uploads don't hammer R2 from a single tab.
  const runQueue = useCallback(async (): Promise<void> => {
    // Latest queue snapshot via ref.
    const pending = queueRef.current.find((q) => q.status === 'waiting');
    if (pending === undefined) return;
    if (queueRef.current.some((q) => q.status === 'uploading')) return;

    const nextAttempt = pending.attemptCount + 1;
    updateQueueItem(pending.id, {
      status: 'uploading',
      progress: 0,
      attemptCount: nextAttempt,
    });

    // Force a setState tick every 500 ms while this file is in `uploading`
    // status. The XHR `progress` event fires opportunistically on each
    // network buffer flush; on a stalled connection it can go silent for
    // many seconds. The interval re-applies the latest known progress
    // value so the displayed integer percentage in [0, 100] never appears
    // frozen for more than 500 ms (Requirement 13.7).
    const progressTickId = setInterval(() => {
      setQueue((current) =>
        current.map((q) =>
          q.id === pending.id && q.status === 'uploading'
            ? { ...q, progress: q.progress }
            : q,
        ),
      );
    }, PROGRESS_TICK_MS);

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
      // Per-file retry budget (Requirement 13.4 / 13.5): after the third
      // failed attempt the file is marked `permanently_failed`, the Retry
      // affordance is hidden, and the final failure reason is retained.
      // No Media_Item row was ever created because `uploadOne` only
      // returns a row on the success branch.
      if (nextAttempt >= MAX_UPLOAD_ATTEMPTS) {
        updateQueueItem(pending.id, {
          status: 'permanently_failed',
          error: msg,
          xhr: null,
        });
      } else {
        updateQueueItem(pending.id, {
          status: 'error',
          error: msg,
          xhr: null,
        });
      }
    } finally {
      clearInterval(progressTickId);
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
          attemptCount: 0,
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
      // Cancel-abort assertion (Requirement 13.6): `xhr.abort()` is
      // synchronous in every supported browser, so the elapsed wall-clock
      // time should be effectively zero. We bracket the call with a
      // `Date.now()` check and emit a `console.warn` if it ever exceeds
      // 1 s — that would signal a regression in the cancel path. The
      // file is removed from the queue regardless, and `finalizeUpload`
      // is never invoked because `uploadOne` rejects with "Upload
      // cancelled." on the `xhr.onabort` handler before the finalize call
      // is reached.
      const startedAt = Date.now();
      try {
        target.xhr.abort();
      } catch {
        // ignore — we still want to remove the entry from the queue
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed > ABORT_BUDGET_MS) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ProjectMediaManager] xhr.abort() took ${elapsed} ms, exceeding the ${ABORT_BUDGET_MS} ms budget.`,
        );
      }
    }
    setQueue((current) => current.filter((q) => q.id !== id));
  }

  function retryUpload(id: string): void {
    setQueue((current) =>
      current.map((q) => {
        if (q.id !== id) return q;
        // Per Requirement 13.4 / 13.5 a `permanently_failed` file has
        // exhausted its retry budget; the Retry affordance is hidden, but
        // we belt-and-brace here in case the button is reached via some
        // other path (e.g., keyboard tab order before the next render).
        if (q.status === 'permanently_failed') return q;
        return { ...q, status: 'waiting', error: null, progress: 0 };
      }),
    );
    void runQueue();
  }

  function clearFinishedQueue(): void {
    // `permanently_failed` rows are intentionally NOT cleared here so the
    // final failure reason stays visible until the admin explicitly
    // removes the row via the Remove affordance (Requirement 13.5).
    setQueue((current) =>
      current.filter((q) => q.status !== 'done' && q.status !== 'error'),
    );
  }

  // ---- Per-row "Replace file" pipeline --------------------------------
  // Re-uses the same presign → PUT envelope as fresh uploads but calls
  // `replaceMediaFile(mediaId, ...)` instead of `finalizeUpload`. Per-row
  // progress is keyed by `mediaId` in `replaceStates` so it never
  // collides with the global multi-file `queue`. On success the row in
  // `items` is replaced by id (preserving its position so `altText`,
  // `caption`, and `ordering` stay visible without a refresh). On the
  // `kind_change_disallowed` rejection branch the original row is left
  // unchanged and the error is rendered inline against the row.
  function patchReplaceState(mediaId: string, patch: Partial<ReplaceState>): void {
    setReplaceStates((current) => {
      const existing = current.get(mediaId);
      if (existing === undefined) return current;
      const next = new Map(current);
      next.set(mediaId, { ...existing, ...patch });
      return next;
    });
  }

  function clearReplaceState(mediaId: string): void {
    setReplaceStates((current) => {
      if (!current.has(mediaId)) return current;
      const next = new Map(current);
      next.delete(mediaId);
      return next;
    });
  }

  async function runReplace(mediaId: string, file: File): Promise<void> {
    const isImage = file.type.startsWith('image/');
    const previewUrl = isImage ? URL.createObjectURL(file) : null;
    const initial: ReplaceState = {
      id: mediaId,
      file,
      previewUrl,
      status: 'uploading',
      progress: 0,
      error: null,
      xhr: null,
      attemptCount: 1,
    };
    setReplaceStates((current) => {
      const next = new Map(current);
      next.set(mediaId, initial);
      return next;
    });

    // Force a re-render every 500 ms while the replace upload is in
    // flight so the displayed percentage never goes stale between XHR
    // `progress` events (Requirement 13.7). Mirrors the cadence used by
    // the main upload queue in `runQueue`.
    const progressTickId = setInterval(() => {
      setReplaceStates((current) => {
        const existing = current.get(mediaId);
        if (existing === undefined || existing.status !== 'uploading') {
          return current;
        }
        const next = new Map(current);
        next.set(mediaId, { ...existing, progress: existing.progress });
        return next;
      });
    }, PROGRESS_TICK_MS);

    try {
      const presignResult = await requestUploadUrl(
        projectId,
        file.name,
        file.type || 'application/octet-stream',
        file.size,
      );
      if (!presignResult.ok) {
        patchReplaceState(mediaId, { status: 'error', error: presignResult.error });
        return;
      }
      const { uploadUrl, publicUrl } = presignResult.value;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            patchReplaceState(mediaId, { progress: percent });
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
        patchReplaceState(mediaId, { xhr });
        xhr.send(file);
      });

      const finalize = await replaceMediaFile(
        mediaId,
        publicUrl,
        file.type || 'application/octet-stream',
        file.size,
        file.name,
      );
      if (!finalize.ok) {
        // `kind_change_disallowed` and every other rejection envelope:
        // the existing row is unchanged on the server, so we MUST NOT
        // mutate `items` here. Surfacing the error inline is enough.
        patchReplaceState(mediaId, {
          status: 'error',
          error: finalize.error,
        });
        return;
      }

      // Replace the row in `items` by id, preserving its position so
      // alt text, caption, and ordering stay visible without a refresh.
      setItems((current) =>
        current.map((row) =>
          row.id === finalize.value.id
            ? {
                id: finalize.value.id,
                storageKey: finalize.value.storageKey,
                mimeType: finalize.value.mimeType,
                kind: finalize.value.kind,
                altText: finalize.value.altText,
                caption: finalize.value.caption,
                ordering: finalize.value.ordering,
                width: finalize.value.width,
                height: finalize.value.height,
                embedUrl: finalize.value.embedUrl,
              }
            : row,
        ),
      );
      patchReplaceState(mediaId, { status: 'done', progress: 100 });
      // Auto-clear the success indicator after a short pause so the row
      // settles back to its normal layout once the new bytes are in.
      setTimeout(() => {
        if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
        clearReplaceState(mediaId);
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patchReplaceState(mediaId, { status: 'error', error: msg });
    } finally {
      clearInterval(progressTickId);
    }
  }

  function dismissReplaceError(mediaId: string): void {
    const state = replaceStates.get(mediaId);
    if (state?.previewUrl !== null && state?.previewUrl !== undefined) {
      URL.revokeObjectURL(state.previewUrl);
    }
    clearReplaceState(mediaId);
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

  function onDragEndItems(event: DragEndEvent): void {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Snapshot the order BEFORE this drop so we can revert on rejection.
    // Only capture the snapshot on the first drop within a debounce window;
    // consecutive drops keep collapsing toward the same pre-drop baseline.
    if (reorderSnapshotRef.current === null) {
      reorderSnapshotRef.current = items;
    }

    const next = arrayMove([...items], oldIndex, newIndex);
    setItems(next);
    setReorderError(null);

    scheduleReorderSubmission();
  }

  function scheduleReorderSubmission(): void {
    // Clear any pending timer so the 500 ms window restarts. Within the
    // window the local `items` array is the source of truth; only the most
    // recent ordering is persisted.
    if (reorderTimerRef.current !== null) {
      clearTimeout(reorderTimerRef.current);
    }
    reorderTimerRef.current = setTimeout(() => {
      reorderTimerRef.current = null;
      void submitReorder();
    }, 500);
  }

  async function submitReorder(): Promise<void> {
    // If a previous request is still in flight (e.g., the user dropped
    // again after 10 s) abort it so we don't race with stale state.
    if (reorderAbortRef.current !== null) {
      reorderAbortRef.current.abort();
      reorderAbortRef.current = null;
    }

    const snapshot = reorderSnapshotRef.current;
    if (snapshot === null) return;

    const orderedIds = itemsRef.current.map((i) => i.id);

    const controller = new AbortController();
    reorderAbortRef.current = controller;

    // 10-second client-side ceiling. The server action call is not
    // natively cancellable, but we ignore the eventual result if the
    // signal fires.
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 10_000);

    let result: Awaited<ReturnType<typeof reorderMediaList>> | null = null;
    let timedOut = false;
    let networkError: string | null = null;
    try {
      const inFlight = reorderMediaList(projectId, orderedIds);
      const aborted = new Promise<'aborted'>((resolve) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            timedOut = true;
            resolve('aborted');
          },
          { once: true },
        );
      });
      const raced = await Promise.race([inFlight, aborted]);
      if (raced !== 'aborted') {
        result = raced;
      }
    } catch (err) {
      networkError = err instanceof Error ? err.message : 'Reorder failed.';
    } finally {
      clearTimeout(timeoutId);
      // Only clear the abort ref if it still points at this controller; a
      // newer drop may have replaced it with a fresh one.
      if (reorderAbortRef.current === controller) {
        reorderAbortRef.current = null;
      }
    }

    if (timedOut) {
      // Revert to the pre-drop snapshot and surface a timeout error.
      setItems(snapshot);
      setReorderError(
        'Reorder timed out after 10 seconds. The previous order has been restored.',
      );
      reorderSnapshotRef.current = null;
      return;
    }

    if (networkError !== null) {
      // Network / runtime failure. Revert and surface the error.
      setItems(snapshot);
      setReorderError(networkError);
      reorderSnapshotRef.current = null;
      return;
    }

    if (result === null) {
      // Should not happen given the race above, but guard defensively.
      reorderSnapshotRef.current = null;
      return;
    }

    if (!result.ok) {
      // unknown_media_id, reorder_count_mismatch, or reorder_duplicate_id —
      // revert the optimistic order to the pre-drop snapshot and surface
      // the error against the row anchor.
      setItems(snapshot);
      setReorderError(result.error);
      reorderSnapshotRef.current = null;
      return;
    }

    // Success: the optimistic order is already correct; clear the snapshot
    // so the next drop captures a fresh baseline.
    reorderSnapshotRef.current = null;
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
                  replaceState={replaceStates.get(item.id) ?? null}
                  onReplaceFile={runReplace}
                  onDismissReplaceError={dismissReplaceError}
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
        {queue.map((q) => {
          const isError = q.status === 'error' || q.status === 'permanently_failed';
          const isPermanent = q.status === 'permanently_failed';
          return (
            <li
              key={q.id}
              role={isError ? 'alert' : undefined}
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
                      isError
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
                {isError && q.error !== null ? (
                  <p className="mt-1 text-xs text-foreground">{q.error}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {/*
                 * Retry is only offered while the file still has retries
                 * left in its budget. After MAX_UPLOAD_ATTEMPTS the file
                 * enters `permanently_failed` and the affordance is
                 * suppressed (Requirement 13.4 / 13.5).
                 */}
                {q.status === 'error' && !isPermanent ? (
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
          );
        })}
      </ul>
    </div>
  );
}

function statusLabel(q: QueuedFile): string {
  if (q.status === 'waiting') return 'Waiting';
  if (q.status === 'uploading') return `Uploading · ${q.progress}%`;
  if (q.status === 'done') return 'Done';
  if (q.status === 'permanently_failed') {
    return `Permanently failed · ${q.attemptCount}/${MAX_UPLOAD_ATTEMPTS} attempts`;
  }
  return `Failed · attempt ${q.attemptCount}/${MAX_UPLOAD_ATTEMPTS}`;
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
  replaceState,
  onReplaceFile,
  onDismissReplaceError,
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
  readonly replaceState: ReplaceState | null;
  readonly onReplaceFile: (mediaId: string, file: File) => Promise<void>;
  readonly onDismissReplaceError: (mediaId: string) => void;
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
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

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

  // Embeds have no stored bytes to replace; the affordance only makes
  // sense for image / video / model3d rows backed by an R2 object.
  const canReplace = item.embedUrl === null;
  const replaceBusy =
    replaceState !== null &&
    (replaceState.status === 'uploading' || replaceState.status === 'waiting');

  function onReplaceFilePicked(e: ChangeEvent<HTMLInputElement>): void {
    const files = e.target.files;
    if (files === null || files.length === 0) return;
    const picked = files[0];
    e.target.value = '';
    if (picked === undefined) return;
    void onReplaceFile(item.id, picked);
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
        {replaceState !== null ? (
          <ReplaceProgress
            state={replaceState}
            onDismiss={() => onDismissReplaceError(item.id)}
          />
        ) : null}
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
        {canReplace ? (
          <>
            <button
              type="button"
              onClick={() => replaceInputRef.current?.click()}
              disabled={replaceBusy}
              aria-busy={replaceBusy}
              className="rounded-full border-2 border-foreground bg-background px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
            >
              {replaceBusy ? 'Replacing…' : 'Replace file'}
            </button>
            <input
              ref={replaceInputRef}
              type="file"
              accept={[...ACCEPTED_MIME, ...ACCEPTED_EXTS].join(',')}
              onChange={onReplaceFilePicked}
              className="hidden"
            />
          </>
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

function ReplaceProgress({
  state,
  onDismiss,
}: {
  readonly state: ReplaceState;
  readonly onDismiss: () => void;
}): ReactElement {
  const isError = state.status === 'error';
  const isDone = state.status === 'done';
  const widthPct = isDone ? 100 : state.progress;
  return (
    <div
      role={isError ? 'alert' : undefined}
      className={`mt-3 rounded-xl border-2 border-foreground p-2 ${
        isError
          ? 'bg-[hsl(var(--color-pop-amber)/0.3)]'
          : isDone
            ? 'bg-[hsl(var(--color-pop-sage)/0.25)]'
            : 'bg-surface'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-foreground">
          Replacing · {state.file.name}
        </p>
        <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-muted">
          {statusLabel(state)}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full border-2 border-foreground bg-background">
        <div
          className={`h-full transition-all ease-soft ${
            isError
              ? 'bg-[hsl(var(--color-pop-amber))]'
              : isDone
                ? 'bg-[hsl(var(--color-pop-sage))]'
                : 'bg-[hsl(var(--color-pop-honey))]'
          }`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      {isError && state.error !== null ? (
        <div className="mt-2 flex items-start justify-between gap-2">
          <p className="text-xs text-foreground">{state.error}</p>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-full border-2 border-foreground bg-background px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em]"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
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
  // Fire-and-forget from the user's perspective: any rejection envelope
  // is surfaced through the action's typed return shape but the
  // optimistic cover badge is already painted. Errors are intentionally
  // swallowed here because the row state stays consistent (the action
  // never writes on a rejection path).
  await setCoverMedia(projectId, mediaId);
}
