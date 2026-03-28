import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAssets } from '../client.js';
import { ImmichSyncError } from '../../utils/errors.js';

// Mock config
vi.mock('../../config.js', () => ({
  config: {
    immichApiUrl: 'http://immich.local',
    immichApiKey: 'test-api-key',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeAsset(id: string) {
  return {
    id,
    type: 'IMAGE',
    originalFileName: `IMG_${id}.jpg`,
    exifInfo: { city: 'Nice', country: 'France' },
    people: [],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Immich client', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('fetches a single page of results', async () => {
    const assets = [makeAsset('1'), makeAsset('2')];
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: assets } }),
    );

    const result = await fetchAssets();

    expect(result).toEqual(assets);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('paginates across multiple pages', async () => {
    // Page 1: 100 items → triggers next page
    const page1 = Array.from({ length: 100 }, (_, i) => makeAsset(`p1-${i}`));
    // Page 2: 100 items → triggers next page
    const page2 = Array.from({ length: 100 }, (_, i) => makeAsset(`p2-${i}`));
    // Page 3: 50 items → last page (< PAGE_SIZE)
    const page3 = Array.from({ length: 50 }, (_, i) => makeAsset(`p3-${i}`));

    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ assets: { items: page1 } }))
      .mockResolvedValueOnce(jsonResponse({ assets: { items: page2 } }))
      .mockResolvedValueOnce(jsonResponse({ assets: { items: page3 } }));

    const result = await fetchAssets();

    expect(result).toHaveLength(250);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Verify page numbers incremented
    const bodies = fetchSpy.mock.calls.map((call: any[]) =>
      JSON.parse(call[1]?.body as string),
    );
    expect(bodies[0].page).toBe(1);
    expect(bodies[1].page).toBe(2);
    expect(bodies[2].page).toBe(3);
  });

  it('returns empty array when first page is empty', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    const result = await fetchAssets();

    expect(result).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('passes updatedAfter when provided', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    await fetchAssets({ updatedAfter: '2024-01-15T00:00:00.000Z' });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.updatedAfter).toBe('2024-01-15T00:00:00.000Z');
  });

  it('sends correct x-api-key header', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    await fetchAssets();

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-api-key');
  });

  it('sends withExif and withPeople in request body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    await fetchAssets();

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.withExif).toBe(true);
    expect(body.withPeople).toBe(true);
  });

  it('calls POST on the correct URL', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    await fetchAssets();

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'http://immich.local/api/search/metadata',
    );
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST');
  });

  it('throws ImmichSyncError on HTTP 500', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(fetchAssets()).rejects.toThrow(ImmichSyncError);

    fetchSpy.mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(fetchAssets()).rejects.toThrow(/HTTP 500/);
  });

  it('throws ImmichSyncError on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(fetchAssets()).rejects.toThrow(ImmichSyncError);
    await expect(fetchAssets()).rejects.toThrow(/Network error/);
  });

  it('strips trailing slashes from base URL', async () => {
    // Re-mock config with trailing slash
    const configMod = await import('../../config.js');
    const origUrl = (configMod.config as any).immichApiUrl;
    (configMod.config as any).immichApiUrl = 'http://immich.local/';

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [] } }),
    );

    await fetchAssets();

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'http://immich.local/api/search/metadata',
    );

    (configMod.config as any).immichApiUrl = origUrl;
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { fetchRecentPhotos, fetchAssetThumbnail } from '../client.js';

describe('fetchRecentPhotos', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches recent IMAGE assets with default limit 10', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ assets: { items: [makeAsset('a1'), makeAsset('a2')] } }),
    );

    const result = await fetchRecentPhotos();

    expect(result).toHaveLength(2);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.type).toBe('IMAGE');
    expect(body.size).toBe(10);
    expect(body.order).toBe('desc');
    expect(body.withExif).toBe(true);
    expect(body.withPeople).toBe(true);
  });

  it('passes takenAfter and takenBefore when provided', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ assets: { items: [] } }));

    await fetchRecentPhotos({
      takenAfter: '2026-03-28T00:00:00.000Z',
      takenBefore: '2026-03-28T23:59:59.999Z',
      limit: 5,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.takenAfter).toBe('2026-03-28T00:00:00.000Z');
    expect(body.takenBefore).toBe('2026-03-28T23:59:59.999Z');
    expect(body.size).toBe(5);
  });

  it('returns empty array when no assets match', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ assets: { items: [] } }));

    const result = await fetchRecentPhotos();

    expect(result).toEqual([]);
  });

  it('throws ImmichSyncError on network failure', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(fetchRecentPhotos()).rejects.toThrow(ImmichSyncError);
  });

  it('throws ImmichSyncError on non-200 response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    await expect(fetchRecentPhotos()).rejects.toThrow('HTTP 401');
  });

  it('throws ImmichSyncError on unparseable JSON', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('not json', { status: 200 }));

    await expect(fetchRecentPhotos()).rejects.toThrow(ImmichSyncError);
  });

  it('throws ImmichSyncError when API URL not configured', async () => {
    const configMod = await import('../../config.js');
    const origUrl = configMod.config.immichApiUrl;
    (configMod.config as any).immichApiUrl = '';

    await expect(fetchRecentPhotos()).rejects.toThrow('not configured');

    (configMod.config as any).immichApiUrl = origUrl;
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('fetchAssetThumbnail', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns base64 encoded JPEG thumbnail', async () => {
    const fakeImage = Buffer.from('fake-jpeg-data');
    fetchSpy.mockResolvedValueOnce(new Response(fakeImage, { status: 200 }));

    const result = await fetchAssetThumbnail('asset-123');

    expect(result.base64).toBe(fakeImage.toString('base64'));
    expect(result.mediaType).toBe('image/jpeg');
  });

  it('calls correct thumbnail URL with preview size', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(Buffer.from('img'), { status: 200 }));

    await fetchAssetThumbnail('asset-456');

    expect(fetchSpy.mock.calls[0]![0]).toContain('/api/assets/asset-456/thumbnail?size=preview');
  });

  it('passes API key header', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(Buffer.from('img'), { status: 200 }));

    await fetchAssetThumbnail('asset-789');

    const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-api-key');
  });

  it('throws ImmichSyncError on non-200 response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(fetchAssetThumbnail('bad-id')).rejects.toThrow('HTTP 404');
  });

  it('throws ImmichSyncError on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(fetchAssetThumbnail('asset-1')).rejects.toThrow(ImmichSyncError);
  });

  it('throws ImmichSyncError when API URL not configured', async () => {
    const configMod = await import('../../config.js');
    const origUrl = configMod.config.immichApiUrl;
    (configMod.config as any).immichApiUrl = '';

    await expect(fetchAssetThumbnail('asset-1')).rejects.toThrow('not configured');

    (configMod.config as any).immichApiUrl = origUrl;
  });
});
