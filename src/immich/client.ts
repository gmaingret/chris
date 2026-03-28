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
      response = await fetch(`${baseUrl}/api/search/metadata`, {
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
