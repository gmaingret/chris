import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { syncStatus } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { GmailSyncError } from '../utils/errors.js';
import { listThreads, getThread } from './client.js';
import { collapseThread } from './collapse.js';
import { storePensieveEntryUpsert, type UpsertAction } from '../pensieve/store.js';
import { embedAndStoreChunked } from '../pensieve/embeddings.js';

const BATCH_SIZE = 50;

export type SendMessage = (text: string) => Promise<unknown>;

/**
 * Build the "after:YYYY/MM/DD" query for threads from the past year.
 */
function buildOneYearQuery(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `after:${yyyy}/${mm}/${dd}`;
}

/**
 * Load the current sync_status row for 'gmail'. Returns null if none exists.
 */
async function loadSyncStatus() {
  const rows = await db
    .select()
    .from(syncStatus)
    .where(eq(syncStatus.source, 'gmail'))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Upsert the sync_status row for 'gmail'.
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
      .where(eq(syncStatus.source, 'gmail'));
  } else {
    await db.insert(syncStatus).values({
      source: 'gmail',
      ...data,
    });
  }
}

/**
 * Process a single thread: fetch full detail, collapse, upsert, and embed if needed.
 * Returns the upsert action or null if the thread was empty/skipped.
 */
async function processThread(
  gmail: gmail_v1.Gmail,
  threadId: string,
): Promise<UpsertAction | null> {
  const thread = await getThread(gmail, threadId);
  const collapsed = collapseThread(thread);

  // Skip empty threads (no extractable body)
  if (!collapsed.text.trim() || collapsed.text.trim() === `Subject: ${collapsed.subject}`) {
    return null;
  }

  const { entry, action } = await storePensieveEntryUpsert(
    collapsed.text,
    'gmail',
    {
      threadId,
      subject: collapsed.subject,
      participants: collapsed.participants,
    },
    'threadId',
  );

  // Embed only new or updated entries
  if (action === 'created' || action === 'updated') {
    await embedAndStoreChunked(entry.id, entry.content);
  }

  return action;
}

/**
 * Full sync: list all threads from the past year with pagination,
 * process in batches, report progress.
 */
async function fullSync(
  gmail: gmail_v1.Gmail,
  sendMessage: SendMessage,
): Promise<{ totalProcessed: number; errorCount: number }> {
  const query = buildOneYearQuery();
  let pageToken: string | undefined;
  let totalProcessed = 0;
  let errorCount = 0;
  let batchIndex = 0;

  // Collect all thread IDs first via pagination
  const allThreadIds: string[] = [];
  do {
    const { threads, nextPageToken } = await listThreads(gmail, query, pageToken);
    for (const t of threads) {
      if (t.id) allThreadIds.push(t.id);
    }
    pageToken = nextPageToken ?? undefined;
  } while (pageToken);

  logger.info(
    { mode: 'full', totalThreads: allThreadIds.length },
    'gmail.sync.start',
  );

  // Process in batches
  for (let i = 0; i < allThreadIds.length; i += BATCH_SIZE) {
    const batch = allThreadIds.slice(i, i + BATCH_SIZE);
    batchIndex++;

    for (const threadId of batch) {
      try {
        const action = await processThread(gmail, threadId);
        if (action) totalProcessed++;
      } catch (error) {
        errorCount++;
        logger.warn(
          {
            threadId,
            error: error instanceof Error ? error.message : String(error),
          },
          'gmail.sync.thread.error',
        );
      }
    }

    logger.info(
      {
        batchIndex,
        processedCount: Math.min(i + BATCH_SIZE, allThreadIds.length),
        totalThreads: allThreadIds.length,
      },
      'gmail.sync.progress',
    );

    await sendMessage(
      `📧 Syncing Gmail... batch ${batchIndex} done (${Math.min(i + BATCH_SIZE, allThreadIds.length)}/${allThreadIds.length} threads)`,
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
 * Incremental sync: use historyId to fetch only changed threads since last sync.
 * Falls back to full sync if historyId is invalid (404).
 */
async function incrementalSync(
  gmail: gmail_v1.Gmail,
  historyId: string,
  sendMessage: SendMessage,
): Promise<{ totalProcessed: number; errorCount: number; fellBackToFull: boolean }> {
  logger.info({ mode: 'incremental', historyId }, 'gmail.sync.start');

  try {
    // Collect changed thread IDs from history
    const changedThreadIds = new Set<string>();
    let pageToken: string | undefined;

    do {
      const res = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: historyId,
        historyTypes: ['messageAdded'],
        pageToken: pageToken ?? undefined,
      });

      const histories = res.data.history ?? [];
      for (const h of histories) {
        const messages = h.messagesAdded ?? [];
        for (const m of messages) {
          if (m.message?.threadId) {
            changedThreadIds.add(m.message.threadId);
          }
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    const threadIds = [...changedThreadIds];
    await sendMessage(
      `📧 Incremental sync: ${threadIds.length} changed thread(s) to process.`,
    );

    let totalProcessed = 0;
    let errorCount = 0;

    for (const threadId of threadIds) {
      try {
        const action = await processThread(gmail, threadId);
        if (action) totalProcessed++;
      } catch (error) {
        errorCount++;
        logger.warn(
          {
            threadId,
            error: error instanceof Error ? error.message : String(error),
          },
          'gmail.sync.thread.error',
        );
      }
    }

    return { totalProcessed, errorCount, fellBackToFull: false };
  } catch (error: unknown) {
    // 404 = historyId expired or invalid → fall back to full sync
    const isNotFound =
      error instanceof Error &&
      'code' in error &&
      (error as { code: number }).code === 404;

    if (isNotFound) {
      logger.warn({ historyId }, 'gmail.sync.historyId.expired — falling back to full sync');
      await sendMessage('⚠️ History expired — running full sync instead.');
      const result = await fullSync(gmail, sendMessage);
      return { ...result, fellBackToFull: true };
    }

    throw error;
  }
}

/**
 * Main sync orchestrator. Called by the /sync gmail command handler.
 *
 * Checks sync_status for 'gmail' — if lastHistoryId exists, runs incremental sync;
 * otherwise runs full sync. Updates sync_status on completion/error.
 * Reports progress back to John via sendMessage callback.
 */
export async function syncGmail(
  authClient: OAuth2Client,
  sendMessage: SendMessage,
): Promise<void> {
  const startTime = Date.now();
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  try {
    const status = await loadSyncStatus();
    const historyId = status?.lastHistoryId;

    let result: { totalProcessed: number; errorCount: number };

    if (historyId) {
      const incResult = await incrementalSync(gmail, historyId, sendMessage);
      result = incResult;
    } else {
      result = await fullSync(gmail, sendMessage);
    }

    // Get latest historyId from profile
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const newHistoryId = profile.data.historyId ?? null;

    const durationMs = Date.now() - startTime;

    // Final sync_status update
    await upsertSyncStatus({
      status: 'complete',
      lastSyncAt: new Date(),
      lastHistoryId: newHistoryId,
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
      'gmail.sync.complete',
    );

    await sendMessage(
      `✅ Gmail sync complete — ${result.totalProcessed} entries processed${result.errorCount > 0 ? `, ${result.errorCount} errors` : ''} (${Math.round(durationMs / 1000)}s).`,
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
      'gmail.sync.error',
    );

    await upsertSyncStatus({
      status: 'error',
      lastError: errMsg.slice(0, 500),
      errorCount: (await loadSyncStatus())?.errorCount ?? 0,
    });

    await sendMessage(`❌ Gmail sync failed: ${errMsg.slice(0, 200)}`);

    throw new GmailSyncError('Gmail sync failed', error);
  }
}
