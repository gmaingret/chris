/**
 * Backfill epistemic tags for entries that were stored before tagging worked.
 * Run with: node dist/scripts/backfill-tags.js
 */
import { isNull } from 'drizzle-orm';
import { db, sql } from '../db/connection.js';
import { pensieveEntries } from '../db/schema.js';
import { tagEntry } from '../pensieve/tagger.js';
import { logger } from '../utils/logger.js';

async function backfillTags(): Promise<void> {
  const log = logger.child({ component: 'backfill-tags' });

  const untagged = await db
    .select({ id: pensieveEntries.id, content: pensieveEntries.content })
    .from(pensieveEntries)
    .where(isNull(pensieveEntries.epistemicTag));

  log.info({ count: untagged.length }, 'Found untagged entries');

  let success = 0;
  let failed = 0;

  for (const entry of untagged) {
    const tag = await tagEntry(entry.id, entry.content);
    if (tag) {
      success++;
      log.info({ entryId: entry.id, tag }, 'Tagged');
    } else {
      failed++;
      log.warn({ entryId: entry.id }, 'Failed to tag');
    }
  }

  log.info({ success, failed, total: untagged.length }, 'Backfill complete');
  await sql.end();
  process.exit(0);
}

backfillTags().catch((err) => {
  logger.fatal(err, 'Backfill failed');
  process.exit(1);
});
