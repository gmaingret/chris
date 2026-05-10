import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './connection.js';
import { logger } from '../utils/logger.js';

/**
 * Runs database migrations at startup.
 * Creates pgvector extension first (required by vector columns in migrations),
 * then executes Drizzle migrations programmatically.
 *
 * Exits process with code 1 on failure — container should not start with
 * an unmigrated database.
 */
export async function runMigrations(): Promise<void> {
  const migrationLogger = logger.child({ component: 'migrations' });

  try {
    migrationLogger.info('Creating pgvector extension...');
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    migrationLogger.info('pgvector extension ready');

    migrationLogger.info('Running database migrations...');
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    migrationLogger.info('Database migrations complete');

    // Phase 32 #4: drift-warning between meta/_journal.json entry count and
    // drizzle.__drizzle_migrations row count. The post-migration state should
    // have one row per journal entry. A persistent mismatch — a class of bug
    // observed in this repo where __drizzle_migrations lost rows due to an
    // upstream incident (deferred forensic Phase 32 item #5; cold trail) —
    // means drizzle's "applied" set has diverged from the source of truth.
    // Warning is intentionally non-fatal: the next migrate run will simply
    // re-apply any missing entries (idempotent CREATE-IF-NOT-EXISTS-style
    // SQL is the convention here), but the warn surfaces incidents weeks
    // earlier than waiting for a downstream symptom.
    await warnIfMigrationsTableDrifted();
  } catch (err) {
    migrationLogger.fatal(err, 'Migration failed');
    process.exit(1);
  }
}

/**
 * Compare meta/_journal.json entries.length against drizzle.__drizzle_migrations
 * row count and log a warn on mismatch. Exceptions are caught and logged at
 * warn level — this check is observability, never a startup blocker.
 */
async function warnIfMigrationsTableDrifted(): Promise<void> {
  const migrationLogger = logger.child({ component: 'migrations' });
  try {
    const journalPath = resolve(
      process.cwd(),
      'src/db/migrations/meta/_journal.json',
    );
    const raw = readFileSync(journalPath, 'utf-8');
    const journal = JSON.parse(raw) as { entries?: Array<{ tag?: string }> };
    const journalCount = Array.isArray(journal.entries)
      ? journal.entries.length
      : 0;

    const rows = await sql<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations
    `;
    const tableCount = rows[0]?.n ?? 0;

    if (tableCount !== journalCount) {
      migrationLogger.warn(
        {
          journalCount,
          tableCount,
          drift: tableCount - journalCount,
        },
        'migrations.journal_drift_detected',
      );
    } else {
      migrationLogger.info(
        { count: journalCount },
        'migrations.journal_in_sync',
      );
    }
  } catch (err) {
    migrationLogger.warn(
      { err: (err as Error).message },
      'migrations.drift_check_failed',
    );
  }
}
