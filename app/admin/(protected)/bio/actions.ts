'use server';

/**
 * Bio editor server actions.
 *
 * `saveBio` — upserts the singleton row plus social links, validates
 * via `validateBioInput`, and revalidates the public landing/about
 * pages.
 *
 * `uploadProfileImage` / `uploadResume` — store the asset in
 * `public/uploads/bio/`, write the metadata onto the Bio singleton,
 * and revalidate.
 */

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/middleware';
import { storeBioAsset } from '@/lib/admin/uploads';
import { prisma } from '@/lib/db/prisma';
import {
  BIO_LIMITS,
  BIO_PROFILE_IMAGE_MIMES,
  BIO_RESUME_MIME,
  validateBioHeader,
} from '@/lib/validation/bio';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface SaveBioState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message: string | null;
  readonly errors: Readonly<Record<string, string>>;
}

export const INITIAL_BIO_STATE: SaveBioState = {
  status: 'idle',
  message: null,
  errors: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimList(formData: FormData, key: string): ReadonlyArray<string> {
  return formData
    .getAll(key)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function revalidateBioPaths(): void {
  revalidatePath('/');
  revalidatePath('/about');
  revalidatePath('/admin/bio');
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export async function saveBio(
  _prev: SaveBioState,
  formData: FormData,
): Promise<SaveBioState> {
  await requireAdmin();

  const artistName = (formData.get('artistName') ?? '').toString().trim();
  const tagline = (formData.get('tagline') ?? '').toString().trim();
  const biography = (formData.get('biography') ?? '').toString();
  const skills = trimList(formData, 'skills');
  const software = trimList(formData, 'software');

  const errors: Record<string, string> = {};

  // Reuse the pure header validator for artistName + tagline.
  const headerCheck = validateBioHeader(artistName, tagline);
  if (!headerCheck.ok) {
    for (const err of headerCheck.errors) {
      if (errors[err.field] === undefined) {
        errors[err.field] = err.message;
      }
    }
  }

  if (biography.length > BIO_LIMITS.biographyMax) {
    errors['biography'] = `Biography must be at most ${BIO_LIMITS.biographyMax} characters.`;
  }
  if (skills.length > BIO_LIMITS.skillsMax) {
    errors['skills'] = `At most ${BIO_LIMITS.skillsMax} skills.`;
  }
  if (software.length > BIO_LIMITS.softwareMax) {
    errors['software'] = `At most ${BIO_LIMITS.softwareMax} software entries.`;
  }

  // Social links: parse repeated platform[i] / url[i] pairs.
  const platforms = formData.getAll('socialPlatform');
  const urls = formData.getAll('socialUrl');
  const linkCount = Math.max(platforms.length, urls.length);
  const socialLinks: Array<{ platform: string; url: string; ordering: number }> = [];
  for (let i = 0; i < linkCount; i++) {
    const platform =
      typeof platforms[i] === 'string' ? (platforms[i] as string).trim() : '';
    const url = typeof urls[i] === 'string' ? (urls[i] as string).trim() : '';
    if (platform.length === 0 && url.length === 0) continue;
    if (platform.length === 0 || url.length === 0) {
      errors[`socialLinks[${i}]`] = 'Both platform and URL are required.';
      continue;
    }
    if (
      platform.length > BIO_LIMITS.socialPlatformMax ||
      url.length > BIO_LIMITS.socialUrlMax
    ) {
      errors[`socialLinks[${i}]`] = 'Platform or URL is too long.';
      continue;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        errors[`socialLinks[${i}]`] = 'URL must start with https://.';
        continue;
      }
    } catch {
      errors[`socialLinks[${i}]`] = 'URL is not a valid https URL.';
      continue;
    }
    socialLinks.push({ platform, url, ordering: socialLinks.length });
  }
  if (socialLinks.length > BIO_LIMITS.socialLinksMax) {
    errors['socialLinks'] = `At most ${BIO_LIMITS.socialLinksMax} social links.`;
  }

  if (Object.keys(errors).length > 0) {
    return {
      status: 'error',
      message: 'Please review the highlighted fields.',
      errors,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.bio.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        artistName,
        tagline,
        biography,
        skills: [...skills],
        software: [...software],
      },
      update: {
        artistName,
        tagline,
        biography,
        skills: [...skills],
        software: [...software],
      },
    });
    await tx.socialLink.deleteMany({ where: { bioId: 'singleton' } });
    if (socialLinks.length > 0) {
      await tx.socialLink.createMany({
        data: socialLinks.map((s) => ({
          bioId: 'singleton',
          platform: s.platform,
          url: s.url,
          ordering: s.ordering,
        })),
      });
    }
  });

  revalidateBioPaths();
  return {
    status: 'success',
    message: 'Bio saved.',
    errors: {},
  };
}

// ---------------------------------------------------------------------------
// Profile image / resume upload
// ---------------------------------------------------------------------------

export async function uploadProfileImage(formData: FormData): Promise<void> {
  'use server';
  await requireAdmin();

  const file = formData.get('profileImage');
  if (!(file instanceof File) || file.size === 0) return;

  const result = await storeBioAsset(file, {
    allowedMimeTypes: [...BIO_PROFILE_IMAGE_MIMES],
    maxBytes: 10 * 1024 * 1024,
    probeImage: true,
  });
  if (!result.ok) {
    // Fall through silently — error surfacing for upload is best-effort
    // for MVP. The user can re-upload.
    return;
  }

  await prisma.bio.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      artistName: '',
      tagline: '',
      biography: '',
      profileImageStorageKey: result.value.storageKey,
      profileImageContentHash: result.value.contentHash,
      profileImageMimeType: result.value.mimeType,
      profileImageWidth: result.value.width,
      profileImageHeight: result.value.height,
      profileImageByteSize: result.value.byteSize,
    },
    update: {
      profileImageStorageKey: result.value.storageKey,
      profileImageContentHash: result.value.contentHash,
      profileImageMimeType: result.value.mimeType,
      profileImageWidth: result.value.width,
      profileImageHeight: result.value.height,
      profileImageByteSize: result.value.byteSize,
    },
  });

  revalidateBioPaths();
}

export async function uploadResume(formData: FormData): Promise<void> {
  'use server';
  await requireAdmin();

  const file = formData.get('resume');
  if (!(file instanceof File) || file.size === 0) return;

  const result = await storeBioAsset(file, {
    allowedMimeTypes: [BIO_RESUME_MIME],
    maxBytes: BIO_LIMITS.resumeMaxBytes,
    probeImage: false,
  });
  if (!result.ok) {
    return;
  }

  await prisma.bio.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      artistName: '',
      tagline: '',
      biography: '',
      resumeStorageKey: result.value.storageKey,
      resumeContentHash: result.value.contentHash,
      resumeMimeType: result.value.mimeType,
      resumeByteSize: result.value.byteSize,
    },
    update: {
      resumeStorageKey: result.value.storageKey,
      resumeContentHash: result.value.contentHash,
      resumeMimeType: result.value.mimeType,
      resumeByteSize: result.value.byteSize,
    },
  });

  revalidateBioPaths();
}
