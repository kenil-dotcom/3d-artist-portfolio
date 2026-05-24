'use server';

/**
 * Inquiry detail server actions.
 *
 * `setInquiryStatus` flips an inquiry's status (read/archived/new) and
 * `deleteInquiry` removes the row plus any reference image children. Both
 * are admin-only and revalidate the inbox list so the inbox reflects the
 * change immediately.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const ALLOWED_STATUSES = new Set(['new', 'read', 'archived']);

export async function setInquiryStatus(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = (formData.get('id') ?? '').toString();
  const next = (formData.get('status') ?? '').toString();
  if (id.length === 0 || !ALLOWED_STATUSES.has(next)) return;

  await prisma.inquiry.update({
    where: { id },
    data: { status: next as 'new' | 'read' | 'archived' },
  });

  revalidatePath('/admin/inquiries');
  revalidatePath(`/admin/inquiries/${id}`);
}

export async function deleteInquiry(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = (formData.get('id') ?? '').toString();
  if (id.length === 0) return;

  // Cascade delete is configured at the Prisma relation level for
  // ReferenceImage and NotificationJob, so a single delete suffices.
  await prisma.inquiry.delete({ where: { id } }).catch(() => {
    // ignore — inquiry already gone
  });

  revalidatePath('/admin/inquiries');
  redirect('/admin/inquiries');
}
