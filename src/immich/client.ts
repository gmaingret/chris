import { fetchWithTimeout } from '../utils/http.js';
import { config } from '../config.js';
import { ImmichSyncError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface ImmichExifInfo {
  city?: string | null;
  country?: string | null;
  state?: string | null;
  dateTimeOriginal?: string | null;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  make?: string | null;
  model?: string | null;
}

export interface ImmichPerson {
  id: string;
  name: string;
}

export interface ImmichAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  originalFileName: string;
  fileCreatedAt?: string;
  exifInfo?: ImmichExifInfo | null;
  people?: ImmichPerson[];
}

const PAGE_SIZE = 100;

/**
 * Fetch all assets from Immich via POST /search/metadata with automatic pagination.
 * Optionally pass `updatedAfter` for incremental sync.
 */
export async function fetchAssets(
  options?: { updatedAfter?: string },
): Promise<ImmichAsset[]> {
  const baseUrl = config.immichApiUrl.replace(/\/+$/, '');
  const apiKey = config.immichApiKey;

  if (!baseUrl || !apiKey) {
    throw new ImmichSyncError('Immich API URL or API key not configured');
  }

  const allAssets: ImmichAsset[] = [];
  let page = 1;

  while (true) {
    const body: Record<string, unknown> = {
      withExif: true,
      withPeople: true,
      page,
      size: PAGE_SIZE,
    };

    if (options?.updatedAfter) {
      body.updatedAfter = options.updatedAfter;
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(`${baseUrl}/api/search/metadata`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ImmichSyncError('Network error contacting Immich API', err);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ImmichSyncError(
        `Immich API returned HTTP ${response.status}: ${text}`,
      );
    }

    let data: { assets?: { items?: ImmichAsset[] } };
    try {
      data = await response.json();
    } catch (err) {
      throw new ImmichSyncError('Failed to parse Immich API response', err);
    }

    const items = data.assets?.items ?? [];
    if (items.length === 0) break;

    allAssets.push(...items);
    logger.debug(`Immich fetch page ${page}: ${items.length} assets`);

    if (items.length < PAGE_SIZE) break; // last page
    page++;
  }

  return allAssets;
}

/**
 * Fetch recent photo assets from Immich, sorted by creation date descending.
 * Uses takenAfter/takenBefore for date-based filtering.
 * Returns IMAGE assets only (skips VIDEO).
 */
export async function fetchRecentPhotos(options?: {
  takenAfter?: string;   // ISO date string
  takenBefore?: string;  // ISO date string
  city?: string;         // filter by city name
  state?: string;        // filter by state/region
  country?: string;      // filter by country
  limit?: number;        // default 10
}): Promise<ImmichAsset[]> {
  const baseUrl = config.immichApiUrl.replace(/\/+$/, '');
  const apiKey = config.immichApiKey;

  if (!baseUrl || !apiKey) {
    throw new ImmichSyncError('Immich API URL or API key not configured');
  }

  const limit = options?.limit ?? 10;

  const body: Record<string, unknown> = {
    type: 'IMAGE',
    withExif: true,
    withPeople: true,
    page: 1,
    size: limit,
    order: 'desc',
  };

  if (options?.takenAfter) body.takenAfter = options.takenAfter;
  if (options?.takenBefore) body.takenBefore = options.takenBefore;
  if (options?.city) body.city = options.city;
  if (options?.state) body.state = options.state;
  if (options?.country) body.country = options.country;

  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl}/api/search/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ImmichSyncError('Network error contacting Immich API', err);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ImmichSyncError(`Immich API returned HTTP ${response.status}: ${text}`);
  }

  let data: { assets?: { items?: ImmichAsset[] } };
  try {
    data = await response.json();
  } catch (err) {
    throw new ImmichSyncError('Failed to parse Immich API response', err);
  }

  const items = data.assets?.items ?? [];
  logger.info({ count: items.length, limit }, 'immich.photos.fetch');
  return items;
}

/**
 * Fetch a photo thumbnail from Immich as a base64-encoded JPEG string.
 * Uses the preview size (~1440px) which is good enough for Claude vision
 * without being excessively large.
 */
export async function fetchAssetThumbnail(assetId: string): Promise<{
  base64: string;
  mediaType: 'image/jpeg';
}> {
  const baseUrl = config.immichApiUrl.replace(/\/+$/, '');
  const apiKey = config.immichApiKey;

  if (!baseUrl || !apiKey) {
    throw new ImmichSyncError('Immich API URL or API key not configured');
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`, {
      headers: { 'x-api-key': apiKey },
    });
  } catch (err) {
    throw new ImmichSyncError(`Network error fetching thumbnail for ${assetId}`, err);
  }

  if (!response.ok) {
    throw new ImmichSyncError(`Immich thumbnail returned HTTP ${response.status} for ${assetId}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    base64: buffer.toString('base64'),
    mediaType: 'image/jpeg',
  };
}
