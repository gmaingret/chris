import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { syncStatus } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { DriveSyncError } from '../utils/errors.js';
import { listFiles, exportFileAsText, getStartPageToken, getChanges } from './client.js';
import type { DriveFile } from './client.js';
import { storePensieveEntryUpsert, type UpsertAction } from '../pensieve/store.js';
import { embedAndStoreChunked } from '../pensieve/embeddings.js';

const BATCH_SIZE = 50;

export type SendMessage = (text: string) => Promise<unknown>;

/**
 * Load the current sync_status row for 'gdrive'. Returns null if none exists.
 */
async function loadSyncStatus() {
  const rows = await db
    .select()
    .from(syncStatus)
    .where(eq(syncStatus.source, 'gdrive'))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Upsert the sync_status row for 'gdrive'.
 */
async function upsertSyncStatus(data: {
  status: string;
  lastSyncAt?: Date;
  lastHistoryId?: string | null;
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
      .where(eq(syncStatus.source, 'gdrive'));
  } else {
    await db.insert(syncStatus).values({
      source: 'gdrive',
      ...data,
    });
  }
}

/** Map a Drive MIME type to a human-readable document type label. */
function docTypeLabel(mimeType: string): string {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return 'Google Doc';
    case 'application/vnd.google-apps.spreadsheet':
      return 'Google Sheet';
    case 'text/plain':
      return 'Text File';
    case 'text/markdown':
      return 'Markdown File';
    case 'text/csv':
      return 'CSV File';
    default:
      return 'Document';
  }
}

/**
 * Format Drive file content as structured text for Pensieve storage.
 */
function formatFileContent(file: DriveFile, content: string): string {
  const modified = file.modifiedTime
    ? file.modifiedTime.slice(0, 10)
    : 'unknown';
  return `Title: ${file.name}\nType: ${docTypeLabel(file.mimeType)}\nModified: ${modified}\n\n${content}`;
}

/**
 * Process a single Drive file: export text, upsert entry, embed if needed.
 * Returns the upsert action or null if the file was empty.
 */
async function processFile(
  drive: drive_v3.Drive,
  file: DriveFile,
): Promise<UpsertAction | null> {
  const content = await exportFileAsText(drive, file.id, file.mimeType);

  // Skip empty files
  if (!content.trim()) {
    return null;
  }

  const formattedText = formatFileContent(file, content);

  const { entry, action } = await storePensieveEntryUpsert(
    formattedText,
    'gdrive',
    {
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
    },
    'fileId',
  );

  // Embed only new or updated entries
  if (action === 'created' || action === 'updated') {
    await embedAndStoreChunked(entry.id, entry.content);
  }

  return action;
}

/**
 * Full sync: list all supported files via pagination,
 * process in batches, report progress.
 */
async function fullSync(
  drive: drive_v3.Drive,
  sendMessage: SendMessage,
): Promise<{ totalProcessed: number; errorCount: number }> {
  // Collect all file objects first via pagination
  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const { files, nextPageToken } = await listFiles(drive, pageToken);
    allFiles.push(...files);
    pageToken = nextPageToken ?? undefined;
  } while (pageToken);

  logger.info(
    { mode: 'full', fileCount: allFiles.length },
    'drive.sync.start',
  );

  let totalProcessed = 0;
  let errorCount = 0;
  let batchIndex = 0;

  // Process in batches
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    batchIndex++;

    for (const file of batch) {
      try {
        const action = await processFile(drive, file);
        if (action) totalProcessed++;
      } catch (error) {
        errorCount++;
        logger.warn(
          {
            fileId: file.id,
            fileName: file.name,
            error: error instanceof Error ? error.message : String(error),
          },
          'drive.sync.file.error',
        );
      }
    }

    logger.info(
      {
        batchIndex,
        processedCount: Math.min(i + BATCH_SIZE, allFiles.length),
        totalFiles: allFiles.length,
      },
      'drive.sync.progress',
    );

    await sendMessage(
      `📄 Syncing Drive... batch ${batchIndex} done (${Math.min(i + BATCH_SIZE, allFiles.length)}/${allFiles.length} files)`,
    );

    // Update sync_status progress mid-sync
    await upsertSyncStatus({
      status: 'syncing',
      entryCount: totalProcessed,
      errorCount,
    });
  }

  return { totalProcessed, errorCount };
}

/**
 * Incremental sync: use Changes API startPageToken to fetch only changed files.
 * Falls back to full sync if the token is invalid (API error).
 */
async function incrementalSync(
  drive: drive_v3.Drive,
  startPageToken: string,
  sendMessage: SendMessage,
): Promise<{ totalProcessed: number; errorCount: number; fellBackToFull: boolean }> {
  logger.info({ mode: 'incremental', startPageToken }, 'drive.sync.start');

  try {
    const { changes, newStartPageToken: _unused } = await getChanges(drive, startPageToken);

    // Filter to non-removed files that have valid file data
    const changedFiles = changes
      .filter((c) => !c.removed && c.file !== null)
      .map((c) => c.file!);

    await sendMessage(
      `📄 Incremental sync: ${changedFiles.length} changed file(s) to process.`,
    );

    let totalProcessed = 0;
    let errorCount = 0;

    for (const file of changedFiles) {
      try {
        const action = await processFile(drive, file);
        if (action) totalProcessed++;
      } catch (error) {
        errorCount++;
        logger.warn(
          {
            fileId: file.id,
            fileName: file.name,
            error: error instanceof Error ? error.message : String(error),
          },
          'drive.sync.file.error',
        );
      }
    }

    return { totalProcessed, errorCount, fellBackToFull: false };
  } catch (error) {
    // Token invalid or API error → fall back to full sync
    if (error instanceof DriveSyncError) {
      logger.warn({ startPageToken }, 'drive.sync.token.expired — falling back to full sync');
      await sendMessage('⚠️ Change token expired — running full sync instead.');
      const result = await fullSync(drive, sendMessage);
      return { ...result, fellBackToFull: true };
    }

    throw error;
  }
}

/**
 * Main sync orchestrator. Called by the /sync drive command handler.
 *
 * Checks sync_status for 'gdrive' — if lastHistoryId (startPageToken) exists,
 * runs incremental sync; otherwise runs full sync. Updates sync_status on
 * completion/error. Reports progress back to John via sendMessage callback.
 */
export async function syncDrive(
  authClient: OAuth2Client,
  sendMessage: SendMessage,
): Promise<void> {
  const startTime = Date.now();
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    const status = await loadSyncStatus();
    const lastToken = status?.lastHistoryId;

    let result: { totalProcessed: number; errorCount: number };

    if (lastToken) {
      const incResult = await incrementalSync(drive, lastToken, sendMessage);
      result = incResult;
    } else {
      result = await fullSync(drive, sendMessage);
    }

    // Get new startPageToken for next incremental sync
    const newToken = await getStartPageToken(drive);

    const durationMs = Date.now() - startTime;

    // Final sync_status update
    await upsertSyncStatus({
      status: 'complete',
      lastSyncAt: new Date(),
      lastHistoryId: newToken,
      entryCount: result.totalProcessed,
      errorCount: result.errorCount,
      lastError: null,
    });

    logger.info(
      {
        totalEntries: result.totalProcessed,
        errorCount: result.errorCount,
        durationMs,
      },
      'drive.sync.complete',
    );

    await sendMessage(
      `✅ Drive sync complete — ${result.totalProcessed} entries processed${result.errorCount > 0 ? `, ${result.errorCount} errors` : ''} (${Math.round(durationMs / 1000)}s).`,
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
      'drive.sync.error',
    );

    await upsertSyncStatus({
      status: 'error',
      lastError: errMsg.slice(0, 500),
      errorCount: (await loadSyncStatus())?.errorCount ?? 0,
    });

    await sendMessage(`❌ Drive sync failed: ${errMsg.slice(0, 200)}`);

    throw new DriveSyncError('Drive sync failed', error);
  }
}
