'use client';

/**
 * Status / delete control bar for the inquiry detail view.
 *
 * Each control is a server-action form. The delete form uses a
 * `confirm()` dialog client-side as a guardrail since deletion cascades
 * through reference images and notification jobs.
 */

import type { ReactElement } from 'react';

import {
  deleteInquiry,
  setInquiryStatus,
} from '@/app/admin/(protected)/inquiries/[id]/actions';

interface InquiryActionsProps {
  readonly id: string;
  readonly status: 'new' | 'read' | 'archived' | 'pending_deletion';
}

export function InquiryActions({
  id,
  status,
}: InquiryActionsProps): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {status !== 'read' ? (
        <form action={setInquiryStatus}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value="read" />
          <button type="submit" className="btn-secondary px-4 py-2 text-xs">
            Mark as read
          </button>
        </form>
      ) : null}
      {status !== 'archived' ? (
        <form action={setInquiryStatus}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value="archived" />
          <button type="submit" className="btn-secondary px-4 py-2 text-xs">
            Archive
          </button>
        </form>
      ) : null}
      {status !== 'new' ? (
        <form action={setInquiryStatus}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value="new" />
          <button type="submit" className="btn-secondary px-4 py-2 text-xs">
            Mark as new
          </button>
        </form>
      ) : null}
      <form
        action={deleteInquiry}
        onSubmit={(e) => {
          if (
            !confirm(
              'Permanently delete this inquiry and any attached reference images?',
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          className="rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-amber))] px-4 py-2 text-xs font-bold text-foreground"
        >
          Delete
        </button>
      </form>
    </div>
  );
}
