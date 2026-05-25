'use client';

/**
 * Editor for a Project's ordered list of typed Section_Blocks.
 *
 * Mirrors the layout, drag-and-drop wiring, and reorder timing envelope
 * of `components/admin/ProjectMediaManager.tsx` so the two surfaces stay
 * visually and behaviourally aligned. The component lives directly
 * under the media manager in `app/admin/(protected)/projects/[id]/edit/
 * page.tsx` and consumes the project's already-loaded `mediaItems`
 * array as the picker's source of truth.
 *
 * Spec references:
 *   - Requirement 1.1, 1.2  — five typed block kinds.
 *   - Requirement 1.3       — added blocks land at `ordering = N`.
 *   - Requirement 1.4       — `text` body trimmed and sanitised by the
 *                             server; we only relay the typed body.
 *   - Requirement 1.13 / 15.5 — virtual seed text block sourced from
 *                             `Project.description`, persisted lazily on
 *                             the first server-side save.
 *   - Requirement 1.16 / 1.17 — server-side reorder rejection codes
 *                             (`unknown_block_id`, `reorder_count_mismatch`,
 *                             `reorder_duplicate_id`) revert local order
 *                             to the pre-drop snapshot.
 *   - Requirement 1.19      — `block_limit_exceeded` disables the
 *                             "Add block" affordance until a block is
 *                             removed.
 *   - Requirement 3.1, 3.6, 3.7 — 500 ms debounce + 10 s
 *                             `AbortController` timeout on reorder
 *                             dispatch (mirrors task 5.5).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  addSectionBlock,
  removeSectionBlock,
  reorderSectionBlocks,
  updateSectionBlock,
} from '@/app/admin/(protected)/projects/[id]/edit/section-actions';

import type { SectionBlockKind } from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Public prop shapes
// ---------------------------------------------------------------------------

/**
 * Subset of `MediaItem` the picker dropdowns need. The page already
 * fetches the project's media items for `ProjectMediaManager`; we
 * accept the same shape so both components share one query. Only
 * image / video / model3d kinds appear in the picker — embeds (which
 * have a non-null `embedUrl` and zero bytes) are excluded because
 * Section_Blocks reference Media_Items by id and embed Media_Items are
 * already wired through `kind === 'video'`.
 */
export interface SectionPickerMediaItem {
  readonly id: string;
  readonly kind: 'image' | 'video' | 'model3d';
  readonly altText: string | null;
  readonly mimeType: string;
  readonly embedUrl: string | null;
}

/**
 * Plain DTO passed in from the server page render. Mirrors the
 * `PersistedSectionBlock` shape returned by the section-block actions
 * with timestamps stripped.
 */
export interface SectionBlockView {
  readonly id: string;
  readonly projectId: string;
  readonly kind: SectionBlockKind;
  readonly ordering: number;
  readonly body: string | null;
  readonly mediaItemId: string | null;
  readonly mediaItemBId: string | null;
}

interface ProjectSectionEditorProps {
  readonly projectId: string;
  readonly slug: string;
  readonly description: string;
  readonly mediaItems: ReadonlyArray<SectionPickerMediaItem>;
  readonly initialBlocks: ReadonlyArray<SectionBlockView>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Local in-memory shape for a block. Adds an `isSeed` flag so the
 * virtual seed text block (sourced from `Project.description`) can be
 * distinguished from persisted rows. Persisted ids are real database
 * uuids; the seed carries the constant `SEED_ID`.
 */
interface EditorBlock {
  readonly id: string;
  readonly kind: SectionBlockKind;
  readonly ordering: number;
  readonly body: string | null;
  readonly mediaItemId: string | null;
  readonly mediaItemBId: string | null;
  readonly isSeed: boolean;
}

interface InlineError {
  readonly code: string;
  readonly error: string;
}

const SEED_ID = '__seed__';
const BLOCK_LIMIT = 200;
const REORDER_DEBOUNCE_MS = 500;
const REORDER_TIMEOUT_MS = 10_000;

const ALL_KINDS: ReadonlyArray<SectionBlockKind> = [
  'text',
  'image',
  'image_pair',
  'video',
  'model3d',
];

const KIND_LABEL: Record<SectionBlockKind, string> = {
  text: 'Text',
  image: 'Image',
  image_pair: 'Image pair',
  video: 'Video',
  model3d: '3D model',
};

const KIND_TIP: Record<SectionBlockKind, string> = {
  text: 'A passage of prose between media.',
  image: 'A single image already uploaded to this project.',
  image_pair: 'Two images side by side.',
  video: 'A video file or YouTube/Vimeo embed.',
  model3d: 'A 3D model preview (.glb / .gltf / .usdz).',
};

const DEFAULT_TEXT_BODY = 'New text section.';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectSectionEditor({
  projectId,
  slug: _slug,
  description,
  mediaItems,
  initialBlocks,
}: ProjectSectionEditorProps): ReactElement {
  // Seed-block synthesis. When the project has no persisted Section_Blocks
  // and a non-empty `Project.description`, surface a virtual seed `text`
  // block sourced from the description so the editor opens with the
  // legacy prose visible. The seed is NOT persisted on first render —
  // only the first time the admin saves any block (Requirement 1.13 /
  // 15.5).
  const initialState: ReadonlyArray<EditorBlock> = useMemo(() => {
    const trimmed = description.trim();
    if (initialBlocks.length === 0 && trimmed.length > 0) {
      return [
        {
          id: SEED_ID,
          kind: 'text' as const,
          ordering: 0,
          body: trimmed,
          mediaItemId: null,
          mediaItemBId: null,
          isSeed: true,
        },
      ];
    }
    return initialBlocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      ordering: b.ordering,
      body: b.body,
      mediaItemId: b.mediaItemId,
      mediaItemBId: b.mediaItemBId,
      isSeed: false,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [blocks, setBlocks] = useState<ReadonlyArray<EditorBlock>>(initialState);
  const [toolbarError, setToolbarError] = useState<InlineError | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [revalidationWarnings, setRevalidationWarnings] = useState<
    ReadonlyArray<string>
  >([]);
  const [pendingKind, setPendingKind] = useState<SectionBlockKind | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  // Reorder debounce + abort machinery. Mirrors the envelope used in
  // `ProjectMediaManager` (task 5.5). The AbortController is a purely
  // client-side "give up" signal — server actions in Next.js are not
  // natively cancellable, so on timeout we revert local state and ignore
  // any eventual server response.
  const reorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reorderAbortRef = useRef<AbortController | null>(null);
  const reorderSnapshotRef = useRef<ReadonlyArray<EditorBlock> | null>(null);
  const blocksRef = useRef<ReadonlyArray<EditorBlock>>(blocks);
  blocksRef.current = blocks;

  // Cleanup pending reorder timers / aborts on unmount.
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

  // Once the count drops below the cap (e.g., after a remove), re-enable
  // the "Add block" affordance.
  useEffect(() => {
    if (blocks.length < BLOCK_LIMIT) {
      setLimitReached(false);
    }
  }, [blocks.length]);

  function recordWarnings(next: ReadonlyArray<string>): void {
    if (next.length > 0) setRevalidationWarnings(next);
  }

  // ---- Seed persistence -------------------------------------------------
  /**
   * Persist the virtual seed text block via `addSectionBlock` if one is
   * present in `current`. Returns the new blocks array (with the seed
   * replaced by its persisted record), the unchanged input when no seed
   * is present, or `null` when the seed could not be persisted.
   *
   * Called as the first step of every save / add / reorder so the seed
   * is materialised lazily on the admin's first save (Requirement 15.5).
   */
  async function persistSeedIfNeeded(
    current: ReadonlyArray<EditorBlock>,
  ): Promise<ReadonlyArray<EditorBlock> | null> {
    const seed = current.find((b) => b.isSeed);
    if (seed === undefined) return current;
    const result = await addSectionBlock(projectId, 'text', {
      body: seed.body ?? '',
    });
    if (!result.ok) {
      setToolbarError({ code: result.code, error: result.error });
      if (result.code === 'block_limit_exceeded') setLimitReached(true);
      return null;
    }
    recordWarnings(result.value.revalidationWarnings);
    return current.map((b) =>
      b.isSeed
        ? {
            id: result.value.id,
            kind: result.value.kind,
            ordering: result.value.ordering,
            body: result.value.body,
            mediaItemId: result.value.mediaItemId,
            mediaItemBId: result.value.mediaItemBId,
            isSeed: false,
          }
        : b,
    );
  }

  // ---- Add ------------------------------------------------------------
  /**
   * Default payload for a freshly added block. Text blocks ship with a
   * placeholder body that satisfies the server-side
   * `invalid_text_body` validator (1..10 000 chars after sanitise).
   * Media-bearing kinds auto-pick the first matching Media_Item from
   * the project so the add succeeds when a candidate is available; if
   * none is available, the action returns `block_media_required` and
   * the rejection is surfaced inline against the toolbar.
   */
  function defaultPayloadFor(kind: SectionBlockKind): {
    body?: string | null;
    mediaItemId?: string | null;
    mediaItemBId?: string | null;
  } {
    if (kind === 'text') return { body: DEFAULT_TEXT_BODY };
    const matching = mediaItems.filter((m) => {
      if (kind === 'image' || kind === 'image_pair') return m.kind === 'image';
      if (kind === 'video') return m.kind === 'video';
      if (kind === 'model3d') return m.kind === 'model3d';
      return false;
    });
    if (kind === 'image_pair') {
      const a = matching[0]?.id ?? null;
      const b = matching.find((m) => m.id !== a)?.id ?? null;
      return { mediaItemId: a, mediaItemBId: b };
    }
    return { mediaItemId: matching[0]?.id ?? null };
  }

  async function handleAdd(kind: SectionBlockKind): Promise<void> {
    setToolbarError(null);
    setPendingKind(kind);
    try {
      const after = await persistSeedIfNeeded(blocksRef.current);
      if (after === null) return;
      if (after !== blocksRef.current) setBlocks(after);

      const result = await addSectionBlock(
        projectId,
        kind,
        defaultPayloadFor(kind),
      );
      if (!result.ok) {
        setToolbarError({ code: result.code, error: result.error });
        if (result.code === 'block_limit_exceeded') setLimitReached(true);
        return;
      }
      recordWarnings(result.value.revalidationWarnings);
      setBlocks((current) => [
        ...current,
        {
          id: result.value.id,
          kind: result.value.kind,
          ordering: result.value.ordering,
          body: result.value.body,
          mediaItemId: result.value.mediaItemId,
          mediaItemBId: result.value.mediaItemBId,
          isSeed: false,
        },
      ]);
    } finally {
      setPendingKind(null);
    }
  }

  // ---- Update --------------------------------------------------------
  /**
   * Save a per-block patch. When the target block is the virtual seed
   * the call routes through `addSectionBlock` instead — the seed's
   * first save is the persistence event. Real blocks first persist any
   * unpersisted seed (so its ordering stays stable) and then apply the
   * patch via `updateSectionBlock`. Returns a result envelope the row
   * uses to render its inline error.
   */
  const handleUpdate = useCallback(
    async (
      blockId: string,
      patch: {
        body?: string | null;
        mediaItemId?: string | null;
        mediaItemBId?: string | null;
      },
    ): Promise<{ ok: boolean; code?: string; error?: string }> => {
      const target = blocksRef.current.find((b) => b.id === blockId);
      if (target === undefined) {
        return { ok: false, code: 'block_not_found', error: 'Block not found.' };
      }

      if (target.isSeed) {
        const seedResult = await addSectionBlock(projectId, 'text', {
          body: patch.body !== undefined ? patch.body : target.body,
        });
        if (!seedResult.ok) {
          if (seedResult.code === 'block_limit_exceeded') setLimitReached(true);
          return {
            ok: false,
            code: seedResult.code,
            error: seedResult.error,
          };
        }
        recordWarnings(seedResult.value.revalidationWarnings);
        setBlocks((current) =>
          current.map((b) =>
            b.id === blockId
              ? {
                  id: seedResult.value.id,
                  kind: seedResult.value.kind,
                  ordering: seedResult.value.ordering,
                  body: seedResult.value.body,
                  mediaItemId: seedResult.value.mediaItemId,
                  mediaItemBId: seedResult.value.mediaItemBId,
                  isSeed: false,
                }
              : b,
          ),
        );
        return { ok: true };
      }

      const after = await persistSeedIfNeeded(blocksRef.current);
      if (after === null) {
        return {
          ok: false,
          code: 'block_limit_exceeded',
          error: 'Block limit reached.',
        };
      }
      if (after !== blocksRef.current) setBlocks(after);

      const result = await updateSectionBlock(blockId, patch);
      if (!result.ok) {
        return { ok: false, code: result.code, error: result.error };
      }
      recordWarnings(result.value.revalidationWarnings);
      setBlocks((current) =>
        current.map((b) =>
          b.id === blockId
            ? {
                id: result.value.id,
                kind: result.value.kind,
                ordering: result.value.ordering,
                body: result.value.body,
                mediaItemId: result.value.mediaItemId,
                mediaItemBId: result.value.mediaItemBId,
                isSeed: false,
              }
            : b,
        ),
      );
      return { ok: true };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId],
  );

  // ---- Remove --------------------------------------------------------
  const handleRemove = useCallback(
    async (blockId: string): Promise<void> => {
      const target = blocksRef.current.find((b) => b.id === blockId);
      if (target === undefined) return;
      if (typeof window !== 'undefined' && !window.confirm('Delete this section block?')) {
        return;
      }
      // The virtual seed was never persisted; just drop it locally.
      if (target.isSeed) {
        setBlocks((current) =>
          current
            .filter((b) => b.id !== blockId)
            .map((b, idx) => ({ ...b, ordering: idx })),
        );
        return;
      }
      const result = await removeSectionBlock(blockId);
      if (!result.ok) {
        setToolbarError({ code: result.code, error: result.error });
        return;
      }
      recordWarnings(result.value.revalidationWarnings);
      setBlocks((current) =>
        current
          .filter((b) => b.id !== blockId)
          .map((b, idx) => ({ ...b, ordering: idx })),
      );
    },
    [],
  );

  // ---- Reorder -------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEndBlocks(event: DragEndEvent): void {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Snapshot only on the first drop within the debounce window so
    // consecutive drops keep collapsing toward the same baseline.
    if (reorderSnapshotRef.current === null) {
      reorderSnapshotRef.current = blocks;
    }

    const next = arrayMove([...blocks], oldIndex, newIndex).map((b, idx) => ({
      ...b,
      ordering: idx,
    }));
    setBlocks(next);
    setReorderError(null);
    scheduleReorderSubmission();
  }

  function scheduleReorderSubmission(): void {
    if (reorderTimerRef.current !== null) {
      clearTimeout(reorderTimerRef.current);
    }
    reorderTimerRef.current = setTimeout(() => {
      reorderTimerRef.current = null;
      void submitReorder();
    }, REORDER_DEBOUNCE_MS);
  }

  async function submitReorder(): Promise<void> {
    if (reorderAbortRef.current !== null) {
      reorderAbortRef.current.abort();
      reorderAbortRef.current = null;
    }

    const snapshot = reorderSnapshotRef.current;
    if (snapshot === null) return;

    // Persist any pending seed first; the seed must have a real id
    // before the server can be asked to reorder it.
    const after = await persistSeedIfNeeded(blocksRef.current);
    if (after === null) {
      setBlocks(snapshot);
      reorderSnapshotRef.current = null;
      return;
    }
    if (after !== blocksRef.current) setBlocks(after);

    const orderedIds = blocksRef.current.map((b) => b.id);

    const controller = new AbortController();
    reorderAbortRef.current = controller;

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REORDER_TIMEOUT_MS);

    let result: Awaited<ReturnType<typeof reorderSectionBlocks>> | null = null;
    let timedOut = false;
    let networkError: string | null = null;
    try {
      const inFlight = reorderSectionBlocks(projectId, orderedIds);
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
      if (reorderAbortRef.current === controller) {
        reorderAbortRef.current = null;
      }
    }

    if (timedOut) {
      setBlocks(snapshot);
      setReorderError(
        'Reorder timed out after 10 seconds. The previous order has been restored.',
      );
      reorderSnapshotRef.current = null;
      return;
    }
    if (networkError !== null) {
      setBlocks(snapshot);
      setReorderError(networkError);
      reorderSnapshotRef.current = null;
      return;
    }
    if (result === null) {
      reorderSnapshotRef.current = null;
      return;
    }
    if (!result.ok) {
      // unknown_block_id, reorder_count_mismatch, or reorder_duplicate_id —
      // revert the optimistic order to the pre-drop snapshot.
      setBlocks(snapshot);
      setReorderError(result.error);
      reorderSnapshotRef.current = null;
      return;
    }

    recordWarnings(result.value.revalidationWarnings);
    reorderSnapshotRef.current = null;
  }

  // ---- Render --------------------------------------------------------
  const dismissWarnings = useCallback(
    () => setRevalidationWarnings([]),
    [],
  );
  const dismissToolbarError = useCallback(
    () => setToolbarError(null),
    [],
  );

  return (
    <div className="space-y-6">
      {revalidationWarnings.length > 0 ? (
        <RevalidationBanner
          warnings={revalidationWarnings}
          onDismiss={dismissWarnings}
        />
      ) : null}

      <AddBlockToolbar
        kinds={ALL_KINDS}
        limitReached={limitReached}
        pendingKind={pendingKind}
        error={toolbarError}
        onAdd={handleAdd}
        onClearError={dismissToolbarError}
      />

      {reorderError !== null ? (
        <p
          role="alert"
          className="rounded-2xl border-2 border-foreground bg-[hsl(var(--color-pop-amber)/0.3)] px-4 py-3 text-sm font-medium text-foreground"
        >
          {reorderError}
        </p>
      ) : null}

      {blocks.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-foreground/30 bg-surface px-4 py-12 text-center text-sm text-muted">
          No sections yet. Use the toolbar above to start building the
          case study.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEndBlocks}
        >
          <SortableContext
            items={blocks.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol role="list" className="space-y-3">
              {blocks.map((block, index) => (
                <SortableBlockRow
                  key={block.id}
                  block={block}
                  index={index}
                  mediaItems={mediaItems}
                  onSave={handleUpdate}
                  onRemove={handleRemove}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function RevalidationBanner({
  warnings,
  onDismiss,
}: {
  readonly warnings: ReadonlyArray<string>;
  readonly onDismiss: () => void;
}): ReactElement {
  return (
    <div
      role="status"
      className="surface-card border-[hsl(var(--color-pop-amber))] bg-[hsl(var(--color-pop-amber)/0.18)] p-4 shadow-[6px_6px_0_0_hsl(var(--color-pop-amber))]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">
            Save succeeded with revalidation warnings
          </p>
          <p className="mt-1 text-xs text-muted">
            The change was persisted, but one or more public paths could
            not be revalidated. They will refresh on the next ISR window.
          </p>
          <ul role="list" className="mt-2 space-y-1 break-all text-xs">
            {warnings.map((w, i) => (
              <li key={i} className="font-mono text-foreground">
                {w}
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-full border-2 border-foreground bg-background px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function AddBlockToolbar({
  kinds,
  limitReached,
  pendingKind,
  error,
  onAdd,
  onClearError,
}: {
  readonly kinds: ReadonlyArray<SectionBlockKind>;
  readonly limitReached: boolean;
  readonly pendingKind: SectionBlockKind | null;
  readonly error: InlineError | null;
  readonly onAdd: (k: SectionBlockKind) => void;
  readonly onClearError: () => void;
}): ReactElement {
  const disabled = limitReached || pendingKind !== null;
  return (
    <div className="surface-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">
          Add block
        </p>
        {limitReached ? (
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-foreground">
            Limit reached · remove a block to add another
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onAdd(k)}
            disabled={disabled}
            aria-busy={pendingKind === k}
            title={KIND_TIP[k]}
            className="rounded-full border-2 border-foreground bg-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingKind === k ? 'Adding…' : `+ ${KIND_LABEL[k]}`}
          </button>
        ))}
      </div>
      {error !== null ? (
        <div className="mt-3 flex items-start justify-between gap-2 rounded-xl border-2 border-foreground bg-[hsl(var(--color-pop-amber)/0.3)] px-3 py-2">
          <p role="alert" className="text-xs text-foreground">
            {error.error}
          </p>
          <button
            type="button"
            onClick={onClearError}
            className="shrink-0 rounded-full border-2 border-foreground bg-background px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em]"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SortableBlockRow({
  block,
  index,
  mediaItems,
  onSave,
  onRemove,
}: {
  readonly block: EditorBlock;
  readonly index: number;
  readonly mediaItems: ReadonlyArray<SectionPickerMediaItem>;
  readonly onSave: (
    blockId: string,
    patch: {
      body?: string | null;
      mediaItemId?: string | null;
      mediaItemBId?: string | null;
    },
  ) => Promise<{ ok: boolean; code?: string; error?: string }>;
  readonly onRemove: (blockId: string) => void;
}): ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const [body, setBody] = useState(block.body ?? '');
  const [mediaA, setMediaA] = useState(block.mediaItemId ?? '');
  const [mediaB, setMediaB] = useState(block.mediaItemBId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<InlineError | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Sync local form state when the parent updates this row (e.g., the
  // seed was just persisted, or a successful save flushed new values).
  useEffect(() => {
    setBody(block.body ?? '');
    setMediaA(block.mediaItemId ?? '');
    setMediaB(block.mediaItemBId ?? '');
  }, [block.id, block.body, block.mediaItemId, block.mediaItemBId]);

  const dirty =
    body !== (block.body ?? '') ||
    mediaA !== (block.mediaItemId ?? '') ||
    mediaB !== (block.mediaItemBId ?? '');

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    boxShadow: isDragging ? '6px 6px 0 0 hsl(var(--color-pop-honey))' : undefined,
  };

  const availableMedia = useMemo(() => {
    if (block.kind === 'image' || block.kind === 'image_pair') {
      return mediaItems.filter((m) => m.kind === 'image');
    }
    if (block.kind === 'video') {
      return mediaItems.filter((m) => m.kind === 'video');
    }
    if (block.kind === 'model3d') {
      return mediaItems.filter((m) => m.kind === 'model3d');
    }
    return [];
  }, [mediaItems, block.kind]);

  async function save(): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      let patch: {
        body?: string | null;
        mediaItemId?: string | null;
        mediaItemBId?: string | null;
      };
      if (block.kind === 'text') {
        patch = { body };
      } else if (block.kind === 'image_pair') {
        patch = {
          mediaItemId: mediaA.length === 0 ? null : mediaA,
          mediaItemBId: mediaB.length === 0 ? null : mediaB,
        };
      } else {
        patch = { mediaItemId: mediaA.length === 0 ? null : mediaA };
      }
      const result = await onSave(block.id, patch);
      if (!result.ok) {
        setError({
          code: result.code ?? 'unknown',
          error: result.error ?? 'Save failed.',
        });
        return;
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled = saving || (!dirty && !block.isSeed);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="grid items-start gap-3 rounded-2xl border-2 border-foreground bg-background p-3 md:grid-cols-[auto_1fr_auto]"
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="flex h-10 w-6 cursor-grab items-center justify-center rounded-md text-foreground/60 hover:bg-surface active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true" className="text-xl leading-none">
          ⋮⋮
        </span>
      </button>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border-2 border-foreground bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground">
            {KIND_LABEL[block.kind]}
          </span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted">
            #{index + 1}
          </span>
          {block.isSeed ? (
            <span className="rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-honey))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground">
              Imported from description · save to migrate
            </span>
          ) : null}
        </div>
        {block.kind === 'text' ? (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the prose for this section…"
            rows={6}
            maxLength={10000}
            className="input-field resize-y text-sm"
          />
        ) : block.kind === 'image_pair' ? (
          <div className="grid gap-2 md:grid-cols-2">
            <MediaPicker
              label="Left image"
              value={mediaA}
              onChange={setMediaA}
              items={availableMedia}
              emptyHint="Upload images first to attach them here."
            />
            <MediaPicker
              label="Right image"
              value={mediaB}
              onChange={setMediaB}
              items={availableMedia}
              emptyHint="Upload images first to attach them here."
            />
          </div>
        ) : (
          <MediaPicker
            label={
              block.kind === 'image'
                ? 'Image'
                : block.kind === 'video'
                  ? 'Video'
                  : '3D model'
            }
            value={mediaA}
            onChange={setMediaA}
            items={availableMedia}
            emptyHint={
              block.kind === 'image'
                ? 'Upload an image first to attach it here.'
                : block.kind === 'video'
                  ? 'Upload a video or add a YouTube/Vimeo embed first.'
                  : 'Upload a 3D model (.glb / .gltf / .usdz) first.'
            }
          />
        )}
        {error !== null ? (
          <p
            role="alert"
            className="rounded-xl border-2 border-foreground bg-[hsl(var(--color-pop-amber)/0.3)] px-3 py-2 text-xs text-foreground"
          >
            {error.error}
          </p>
        ) : null}
        {savedFlash ? (
          <p className="text-xs text-muted">✓ Saved</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saveDisabled}
          aria-busy={saving}
          className="btn-primary px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => onRemove(block.id)}
          className="rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-amber))] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function MediaPicker({
  label,
  value,
  onChange,
  items,
  emptyHint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly items: ReadonlyArray<SectionPickerMediaItem>;
  readonly emptyHint: string;
}): ReactElement {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field mt-1 py-2 text-sm"
      >
        <option value="">— Select —</option>
        {items.map((m) => (
          <option key={m.id} value={m.id}>
            {pickerLabel(m)}
          </option>
        ))}
      </select>
      {items.length === 0 ? (
        <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted">
          {emptyHint}
        </p>
      ) : null}
    </label>
  );
}

function pickerLabel(m: SectionPickerMediaItem): string {
  if (m.altText !== null && m.altText.trim().length > 0) return m.altText;
  if (m.embedUrl !== null) return `embed · ${m.embedUrl.slice(0, 64)}`;
  return `${m.kind} · ${m.id.slice(0, 8)}`;
}
