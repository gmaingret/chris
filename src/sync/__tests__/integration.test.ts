/**
 * Integration tests for M003 sync pipeline against a real Postgres database.
 * Requires DATABASE_URL pointing to a running pgvector instance with migrations applied.
 *
 * Run: DATABASE_URL=... npx vitest run src/sync/__tests__/integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { db, sql } from '../../db/connection.js';
import { syncStatus, oauthTokens, pensieveEntries, pensieveEmbeddings } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

describe('M003 integration: real DB', () => {
  beforeAll(async () => {
    // Verify DB connection
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    // Clean up test data
    await db.delete(syncStatus);
    await db.delete(oauthTokens);
  });

  describe('schema: sync_status table', () => {
    it('inserts and reads a sync_status row', async () => {
      await db.insert(syncStatus).values({
        source: 'gmail',
        status: 'complete',
        entryCount: 42,
        errorCount: 0,
        lastSyncAt: new Date(),
        lastHistoryId: '12345',
        lastError: null,
      });

      const rows = await db.select().from(syncStatus).where(eq(syncStatus.source, 'gmail'));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source).toBe('gmail');
      expect(rows[0]!.status).toBe('complete');
      expect(rows[0]!.entryCount).toBe(42);
      expect(rows[0]!.errorCount).toBe(0);
      expect(rows[0]!.lastHistoryId).toBe('12345');
    });

    it('enforces unique constraint on source', async () => {
      await db.insert(syncStatus).values({
        source: 'immich',
        status: 'idle',
        entryCount: 0,
        errorCount: 0,
      });

      await expect(
        db.insert(syncStatus).values({
          source: 'immich',
          status: 'syncing',
          entryCount: 0,
          errorCount: 0,
        }),
      ).rejects.toThrow();
    });

    it('tracks all four sync sources independently', async () => {
      const sources = ['gmail', 'immich', 'gdrive', 'telegram_file'];
      for (const source of sources) {
        await db.insert(syncStatus).values({
          source,
          status: 'complete',
          entryCount: 10,
          errorCount: 0,
        });
      }

      const rows = await db.select().from(syncStatus);
      expect(rows).toHaveLength(4);
      const rowSources = rows.map((r) => r.source).sort();
      expect(rowSources).toEqual(['gdrive', 'gmail', 'immich', 'telegram_file']);
    });

    it('updates sync_status via upsert pattern (status, counts, error)', async () => {
      await db.insert(syncStatus).values({
        source: 'gmail',
        status: 'syncing',
        entryCount: 0,
        errorCount: 0,
      });

      await db
        .update(syncStatus)
        .set({
          status: 'error',
          entryCount: 15,
          errorCount: 3,
          lastError: 'OAuth token expired',
          lastSyncAt: new Date(),
        })
        .where(eq(syncStatus.source, 'gmail'));

      const rows = await db.select().from(syncStatus).where(eq(syncStatus.source, 'gmail'));
      expect(rows[0]!.status).toBe('error');
      expect(rows[0]!.entryCount).toBe(15);
      expect(rows[0]!.errorCount).toBe(3);
      expect(rows[0]!.lastError).toBe('OAuth token expired');
      expect(rows[0]!.lastSyncAt).toBeInstanceOf(Date);
    });
  });

  describe('schema: oauth_tokens table', () => {
    it('inserts and reads OAuth tokens', async () => {
      await db.insert(oauthTokens).values({
        provider: 'google',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiryDate: Date.now() + 3600000,
        scope: 'gmail.readonly drive.readonly',
      });

      const rows = await db.select().from(oauthTokens).where(eq(oauthTokens.provider, 'google'));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.provider).toBe('google');
      expect(rows[0]!.accessToken).toBe('test-access-token');
      expect(rows[0]!.refreshToken).toBe('test-refresh-token');
      expect(rows[0]!.scope).toBe('gmail.readonly drive.readonly');
    });

    it('enforces unique constraint on provider', async () => {
      await db.insert(oauthTokens).values({
        provider: 'google',
        accessToken: 'tok1',
        refreshToken: 'ref1',
        expiryDate: Date.now(),
      });

      await expect(
        db.insert(oauthTokens).values({
          provider: 'google',
          accessToken: 'tok2',
          refreshToken: 'ref2',
          expiryDate: Date.now(),
        }),
      ).rejects.toThrow();
    });
  });

  describe('schema: pensieve_entries supports source provenance', () => {
    afterEach(async () => {
      await db.delete(pensieveEmbeddings);
      await db.delete(pensieveEntries);
    });

    it('stores entries with source and metadata fields', async () => {
      const inserted = await db
        .insert(pensieveEntries)
        .values({
          content: 'Email thread about project planning',
          source: 'gmail',
          metadata: { threadId: 'abc123', subject: 'Q1 Planning' },
          contentHash: 'hash-abc123',
        })
        .returning();

      expect(inserted).toHaveLength(1);
      expect(inserted[0]!.source).toBe('gmail');
      expect(inserted[0]!.metadata).toEqual({ threadId: 'abc123', subject: 'Q1 Planning' });
      expect(inserted[0]!.contentHash).toBe('hash-abc123');
    });

    it('stores entries from multiple sources', async () => {
      await db.insert(pensieveEntries).values([
        {
          content: 'Gmail thread content',
          source: 'gmail',
          metadata: { threadId: 't1' },
          contentHash: 'hash-gmail',
        },
        {
          content: 'Photo in Nice, France',
          source: 'immich',
          metadata: { assetId: 'a1' },
          contentHash: 'hash-immich',
        },
        {
          content: 'Drive document content',
          source: 'gdrive',
          metadata: { fileId: 'f1' },
          contentHash: 'hash-gdrive',
        },
      ]);

      const rows = await db.select().from(pensieveEntries);
      expect(rows).toHaveLength(3);
      const sources = rows.map((r) => r.source).sort();
      expect(sources).toEqual(['gdrive', 'gmail', 'immich']);
    });

    it('supports 1:N embeddings per entry via chunk_index', async () => {
      const [entry] = await db
        .insert(pensieveEntries)
        .values({
          content: 'Long document that gets chunked',
          source: 'telegram_file',
          metadata: { fileName: 'report.pdf' },
          contentHash: 'hash-chunked',
        })
        .returning();
      expect(entry).toBeDefined();

      // Insert 3 embedding chunks
      for (let i = 0; i < 3; i++) {
        await db.insert(pensieveEmbeddings).values({
          entryId: entry!.id,
          embedding: Array(1024).fill(0.1),
          chunkIndex: i,
        });
      }

      const embeddings = await db
        .select()
        .from(pensieveEmbeddings)
        .where(eq(pensieveEmbeddings.entryId, entry!.id));
      expect(embeddings).toHaveLength(3);
      const indices = embeddings.map((e) => e.chunkIndex).sort();
      expect(indices).toEqual([0, 1, 2]);
    });
  });

  describe('cross-table: sync pipeline data flow', () => {
    afterEach(async () => {
      await db.delete(pensieveEmbeddings);
      await db.delete(pensieveEntries);
    });

    it('simulates full sync lifecycle: insert entries, update sync_status, verify consistency', async () => {
      // 1. Start sync — set status to syncing
      await db.insert(syncStatus).values({
        source: 'gmail',
        status: 'syncing',
        entryCount: 0,
        errorCount: 0,
      });

      // 2. Insert entries (simulating sync orchestrator work)
      const entries = await db
        .insert(pensieveEntries)
        .values([
          { content: 'Thread 1', source: 'gmail', metadata: { threadId: 't1' }, contentHash: 'h1' },
          { content: 'Thread 2', source: 'gmail', metadata: { threadId: 't2' }, contentHash: 'h2' },
          { content: 'Thread 3', source: 'gmail', metadata: { threadId: 't3' }, contentHash: 'h3' },
        ])
        .returning();

      expect(entries).toHaveLength(3);

      // 3. Add embeddings for each entry
      for (const entry of entries) {
        await db.insert(pensieveEmbeddings).values({
          entryId: entry!.id,
          embedding: Array(1024).fill(0.01),
          chunkIndex: 0,
        });
      }

      // 4. Complete sync — update sync_status
      await db
        .update(syncStatus)
        .set({
          status: 'complete',
          entryCount: 3,
          errorCount: 0,
          lastSyncAt: new Date(),
          lastHistoryId: '99999',
        })
        .where(eq(syncStatus.source, 'gmail'));

      // 5. Verify final state
      const [status] = await db.select().from(syncStatus).where(eq(syncStatus.source, 'gmail'));
      expect(status!.status).toBe('complete');
      expect(status!.entryCount).toBe(3);

      const allEntries = await db
        .select()
        .from(pensieveEntries)
        .where(eq(pensieveEntries.source, 'gmail'));
      expect(allEntries).toHaveLength(3);

      const allEmbeddings = await db.select().from(pensieveEmbeddings);
      expect(allEmbeddings).toHaveLength(3);
    });
  });
});
