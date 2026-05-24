/**
 * Pure URL parser for externally hosted videos.
 *
 * Recognises YouTube and Vimeo URLs that the admin pastes into the project
 * editor's "+ Add video link" panel and returns a normalised embed URL plus
 * (when available) a thumbnail URL. The function is I/O-free, never throws
 * on bad inputs, and returns `null` when the input is not a recognised
 * format so the caller can show a validation error instead.
 */

export type EmbedProvider = 'youtube' | 'vimeo';

export interface EmbedParseResult {
  readonly provider: EmbedProvider;
  /** Canonical embed URL safe to drop into an `<iframe src>` attribute. */
  readonly embedUrl: string;
  /** Provider thumbnail URL, or `null` when the provider doesn't expose one. */
  readonly thumbnailUrl: string | null;
  /** Stable provider-side video id (useful for analytics, dedupe). */
  readonly videoId: string;
}

/**
 * Recognised YouTube URL patterns:
 *   - https://www.youtube.com/watch?v=ID[&...]
 *   - https://youtube.com/watch?v=ID
 *   - https://m.youtube.com/watch?v=ID
 *   - https://music.youtube.com/watch?v=ID
 *   - https://youtu.be/ID
 *   - https://www.youtube.com/embed/ID
 *   - https://www.youtube.com/shorts/ID
 *   - https://www.youtube.com/live/ID
 *
 * Vimeo:
 *   - https://vimeo.com/{numeric_id}
 *   - https://player.vimeo.com/video/{numeric_id}
 *   - https://vimeo.com/channels/.../{numeric_id}
 */
const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);
const VIMEO_HOSTS: ReadonlySet<string> = new Set([
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
]);

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/u;
const VIMEO_ID_PATTERN = /^[0-9]{6,15}$/u;

/**
 * Parse `input` and return a normalised embed reference, or `null` when the
 * input is not a recognised YouTube or Vimeo URL. Whitespace is trimmed; any
 * non-https scheme is rejected since both providers require https embeds.
 */
export function parseEmbedUrl(input: string): EmbedParseResult | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') {
    return null;
  }

  const host = url.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host)) {
    const id = extractYouTubeId(url, host);
    if (id === null) return null;
    return {
      provider: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${id}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
      videoId: id,
    };
  }

  if (VIMEO_HOSTS.has(host)) {
    const id = extractVimeoId(url, host);
    if (id === null) return null;
    return {
      provider: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${id}`,
      thumbnailUrl: null,
      videoId: id,
    };
  }

  return null;
}

function extractYouTubeId(url: URL, host: string): string | null {
  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\/+/u, '').split('/')[0] ?? '';
    return YOUTUBE_ID_PATTERN.test(id) ? id : null;
  }

  // /watch?v=ID
  const queryV = url.searchParams.get('v');
  if (queryV !== null && YOUTUBE_ID_PATTERN.test(queryV)) {
    return queryV;
  }

  // /embed/ID, /shorts/ID, /live/ID
  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length >= 2) {
    const head = segments[0];
    const tail = segments[1];
    if (
      typeof head === 'string' &&
      typeof tail === 'string' &&
      (head === 'embed' || head === 'shorts' || head === 'live') &&
      YOUTUBE_ID_PATTERN.test(tail)
    ) {
      return tail;
    }
  }

  return null;
}

function extractVimeoId(url: URL, host: string): string | null {
  const segments = url.pathname.split('/').filter((s) => s.length > 0);

  if (host === 'player.vimeo.com') {
    // /video/{id}
    if (segments[0] === 'video') {
      const id = segments[1] ?? '';
      return VIMEO_ID_PATTERN.test(id) ? id : null;
    }
    return null;
  }

  // vimeo.com/{id} OR vimeo.com/channels/{name}/{id} OR vimeo.com/groups/{name}/videos/{id}
  // Walk segments from the end; the numeric id is always the trailing segment.
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (typeof segment === 'string' && VIMEO_ID_PATTERN.test(segment)) {
      return segment;
    }
  }
  return null;
}
