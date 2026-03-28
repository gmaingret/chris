import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { syncStatus } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { ImmichSyncError } from '../utils/errors.js';
import { fetchAssets, type ImmichAsset } from './client.js';
import { assetToText } from './metadata.js';
import { storePensieveEntryUpsert } from '../pensieve/store.js';
import { embedAndStoreChunked } from '../pensieve/embeddings.js';

const BATCH_SIZE = 50;

export type SendMessage = (text: string) => Promise<unknown>;

/**
 * Load the current sync_status row for 'immich'. Returns null if none exists.
 */
export async function loadSyncStatus() {
  const rows = await db
    .select()
    .from(syncStatus)
    .where(eq(syncStatus.source, 'immich'))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Upsert the sync_status row for 'immich'.
 */
export async function upsertSyncStatus(data: {
  status: string;
  lastSyncAt?: Date;
  entryCount?: number;
  errorCount?: number;
  lastError?: string | null;
}) {
  const existing = await loadSyncStatus();
  if (existing) {
    await db
      .update(syncStatus)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(syncStatus.source, 'immich'));
  } else {
    await db.insert(syncStatus).values({
      source: 'immich',
      ...data,
    });
  }
}

/**
 * Process a single asset: convert to text, upsert entry, embed if needed.
 * Returns true if an entry was created or updated, false if skipped.
 */
async function processAsset(asset: ImmichAsset): Promise<boolean> {
  const text = assetToText(asset);

  const { entry, action } = await storePensieveEntryUpsert(
    text,
    'immich',
    {
      assetId: asset.id,
      type: asset.type,
      fileName: asset.originalFileName,
    },
    'assetId',
  );

  if (action === 'created' || action === 'updated') {
    await embedAndStoreChunked(entry.id, entry.content);
    return true;
  }

  return false;
}

/**
 * Main sync orchestrator. Called by the /sync photos command handler.
 *
 * Checks sync_status for 'immich' — if lastSyncAt exists, runs incremental sync
 * (fetching only assets updated after lastSyncAt); otherwise runs full sync.
 * Updates sync_status on completion/error.
 * Reports progress back via sendMessage callback.
 */
export async function syncImmich(sendMessage: SendMessage): Promise<void> {
  const startTime = Date.now();

  try {
    const status = await loadSyncStatus();
    const lastSyncAt = status?.lastSyncAt;

    // Determine mode and fetch assets
    const mode = lastSyncAt ? 'incremental' : 'full';
    const fetchOptions = lastSyncAt
      ? { updatedAfter: lastSyncAt.toISOString() }
      : undefined;

    const assets = await fetchAssets(fetchOptions);

    logger.info(
      { mode, assetCount: assets.length },
      'immich.sync.start',
    );

    if (assets.length === 0) {
      await upsertSyncStatus({
        status: 'complete',
        lastSyncAt: new Date(),
        entryCount: 0,
        errorCount: 0,
        lastError: null,
      });

      const durationMs = Date.now() - startTime;
      logger.info(
        { totalEntries: 0, errorCount: 0, durationMs },
        'immich.sync.complete',
      );

      await sendMessage('✅ Immich sync complete — no new assets to process.');
      return;
    }

    // Mark as syncing
    await upsertSyncStatus({ status: 'syncing' });

    let totalProcessed = 0;
    let errorCount = 0;

    // Process in batches
    for (let i = 0; i < assets.length; i += BATCH_SIZE) {
      const batch = assets.slice(i, i + BATCH_SIZE);
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;

      for (const asset of batch) {
        try {
          const wasProcessed = await processAsset(asset);
          if (wasProcessed) totalProcessed++;
        } catch (error) {
          errorCount++;
          logger.warn(
            {
              assetId: asset.id,
              error: error instanceof Error ? error.message : String(error),
            },
            'immich.sync.asset.error',
          );
        }
      }

      logger.info(
        {
          batch: batchIndex,
          processed: Math.min(i + BATCH_SIZE, assets.length),
          total: assets.length,
        },
        'immich.sync.progress',
      );

      await sendMessage(
        `📷 Syncing photos... batch ${batchIndex} done (${Math.min(i + BATCH_SIZE, assets.length)}/${assets.length} assets)`,
      );

      // Update sync_status mid-sync
      await upsertSyncStatus({
        status: 'syncing',
        entryCount: totalProcessed,
        errorCount,
      });
    }

    const durationMs = Date.now() - startTime;

    // Final sync_status update
    await upsertSyncStatus({
      status: 'complete',
      lastSyncAt: new Date(),
      entryCount: totalProcessed,
      errorCount,
      lastError: null,
    });

    logger.info(
      { totalEntries: totalProcessed, errorCount, durationMs },
      'immich.sync.complete',
    );

    await sendMessage(
      `✅ Immich sync complete — ${totalProcessed} entries processed${errorCount > 0 ? `, ${errorCount} errors` : ''} (${Math.round(durationMs / 1000)}s).`,
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);

    logger.error(
      {
        phase: 'sync',
        error: errMsg,
        durationMs,
      },
      'immich.sync.error',
    );

    await upsertSyncStatus({
      status: 'error',
      lastError: errMsg.slice(0, 500),
      errorCount: (await loadSyncStatus())?.errorCount ?? 0,
    });

    await sendMessage(`❌ Immich sync failed: ${errMsg.slice(0, 200)}`);

    throw new ImmichSyncError('Immich sync failed', error);
  }
}
