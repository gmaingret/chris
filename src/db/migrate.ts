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
  } catch (err) {
    migrationLogger.fatal(err, 'Migration failed');
    process.exit(1);
  }
}
