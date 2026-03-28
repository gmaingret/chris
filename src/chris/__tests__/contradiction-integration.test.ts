/**
 * Integration tests for contradiction detection against a real Postgres database.
 * Tests the full pipeline: store entries → detect contradictions → resolve.
 *
 * Run: DATABASE_URL=... ANTHROPIC_API_KEY=test npx vitest run src/chris/__tests__/contradiction-integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { db, sql } from '../../db/connection.js';
import { pensieveEntries, contradictions } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

describe('contradiction integration: real DB', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    await db.delete(contradictions);
    await db.delete(pensieveEntries);
  });

  describe('contradictions table CRUD', () => {
    it('inserts and reads a contradiction row', async () => {
      // Insert two entries first
      const [entryA] = await db.insert(pensieveEntries).values({
        content: 'I will never go back to corporate work',
        source: 'telegram',
      }).returning();

      const [entryB] = await db.insert(pensieveEntries).values({
        content: 'I am excited about this corporate offer',
        source: 'telegram',
      }).returning();

      // Insert a contradiction linking them
      const [contradiction] = await db.insert(contradictions).values({
        entryAId: entryA!.id,
        entryBId: entryB!.id,
        description: 'Changed stance on corporate work',
        status: 'DETECTED',
      }).returning();

      expect(contradiction!.id).toBeDefined();
      expect(contradiction!.status).toBe('DETECTED');
      expect(contradiction!.entryAId).toBe(entryA!.id);
      expect(contradiction!.entryBId).toBe(entryB!.id);
    });

    it('updates contradiction status to RESOLVED with resolution text', async () => {
      const [entryA] = await db.insert(pensieveEntries).values({
        content: 'Entry A',
        source: 'telegram',
      }).returning();

      const [entryB] = await db.insert(pensieveEntries).values({
        content: 'Entry B',
        source: 'telegram',
      }).returning();

      const [contradiction] = await db.insert(contradictions).values({
        entryAId: entryA!.id,
        entryBId: entryB!.id,
        description: 'Test contradiction',
        status: 'DETECTED',
      }).returning();

      // Resolve it
      await db.update(contradictions)
        .set({
          status: 'RESOLVED',
          resolution: 'I changed my mind and that is OK',
          resolvedAt: new Date(),
        })
        .where(eq(contradictions.id, contradiction!.id));

      // Read it back
      const [resolved] = await db.select()
        .from(contradictions)
        .where(eq(contradictions.id, contradiction!.id));

      expect(resolved!.status).toBe('RESOLVED');
      expect(resolved!.resolution).toBe('I changed my mind and that is OK');
      expect(resolved!.resolvedAt).not.toBeNull();
    });

    it('updates contradiction status to ACCEPTED', async () => {
      const [entryA] = await db.insert(pensieveEntries).values({
        content: 'Entry A', source: 'telegram',
      }).returning();

      const [entryB] = await db.insert(pensieveEntries).values({
        content: 'Entry B', source: 'telegram',
      }).returning();

      const [contradiction] = await db.insert(contradictions).values({
        entryAId: entryA!.id,
        entryBId: entryB!.id,
        description: 'Both are true',
        status: 'DETECTED',
      }).returning();

      await db.update(contradictions)
        .set({ status: 'ACCEPTED', resolution: 'Both statements are true for me' })
        .where(eq(contradictions.id, contradiction!.id));

      const [accepted] = await db.select()
        .from(contradictions)
        .where(eq(contradictions.id, contradiction!.id));

      expect(accepted!.status).toBe('ACCEPTED');
    });
  });

  describe('getUnresolvedContradictions', () => {
    // Dynamic import to avoid config issues — module loads after DB is ready
    let getUnresolvedContradictions: () => Promise<any[]>;

    beforeAll(async () => {
      const mod = await import('../contradiction.js');
      getUnresolvedContradictions = mod.getUnresolvedContradictions;
    });

    it('returns empty array when no DETECTED contradictions exist', async () => {
      const result = await getUnresolvedContradictions();
      expect(result).toEqual([]);
    });

    it('returns DETECTED contradictions with entry content', async () => {
      const [entryA] = await db.insert(pensieveEntries).values({
        content: 'I love remote work',
        source: 'telegram',
      }).returning();

      const [entryB] = await db.insert(pensieveEntries).values({
        content: 'I prefer going to the office',
        source: 'telegram',
      }).returning();

      await db.insert(contradictions).values({
        entryAId: entryA!.id,
        entryBId: entryB!.id,
        description: 'Changed stance on remote work',
        status: 'DETECTED',
      });

      const result = await getUnresolvedContradictions();

      expect(result).toHaveLength(1);
      expect(result[0]!.description).toBe('Changed stance on remote work');
      expect(result[0]!.entryAContent).toBe('I love remote work');
      expect(result[0]!.entryBContent).toBe('I prefer going to the office');
    });

    it('does NOT return RESOLVED contradictions', async () => {
      const [entryA] = await db.insert(pensieveEntries).values({
        content: 'A', source: 'telegram',
      }).returning();

      const [entryB] = await db.insert(pensieveEntries).values({
        content: 'B', source: 'telegram',
      }).returning();

      await db.insert(contradictions).values({
        entryAId: entryA!.id,
        entryBId: entryB!.id,
        description: 'Already resolved',
        status: 'RESOLVED',
        resolution: 'Fixed',
      });

      const result = await getUnresolvedContradictions();
      expect(result).toEqual([]);
    });

    it('returns multiple DETECTED contradictions', async () => {
      const entries = await Promise.all([
        db.insert(pensieveEntries).values({ content: 'A1', source: 'telegram' }).returning(),
        db.insert(pensieveEntries).values({ content: 'B1', source: 'telegram' }).returning(),
        db.insert(pensieveEntries).values({ content: 'A2', source: 'telegram' }).returning(),
        db.insert(pensieveEntries).values({ content: 'B2', source: 'telegram' }).returning(),
      ]);

      await db.insert(contradictions).values([
        {
          entryAId: entries[0]![0]!.id,
          entryBId: entries[1]![0]!.id,
          description: 'First contradiction',
          status: 'DETECTED',
        },
        {
          entryAId: entries[2]![0]!.id,
          entryBId: entries[3]![0]!.id,
          description: 'Second contradiction',
          status: 'DETECTED',
        },
      ]);

      const result = await getUnresolvedContradictions();
      expect(result).toHaveLength(2);
    });
  });

  describe('resolveContradiction', () => {
    let resolveContradiction: (id: string, resolution: string, status?: 'RESOLVED' | 'ACCEPTED') => Promise<void>;

    beforeAll(async () => {
      const mod = await import('../contradiction.js');
      resolveContradiction = mod.resolveContradiction;
    });

    it('resolves a DETECTED contradiction in the database', async () => {
      const [entryA] = await db.insert(pensieveEntries).values({
        content: 'Entry A', source: 'telegram',
      }).returning();

      const [entryB] = await db.insert(pensieveEntries).values({
        content: 'Entry B', source: 'telegram',
      }).returning();

      const [contradiction] = await db.insert(contradictions).values({
        entryAId: entryA!.id,
        entryBId: entryB!.id,
        description: 'Test',
        status: 'DETECTED',
      }).returning();

      await resolveContradiction(contradiction!.id, 'I changed my mind');

      const [resolved] = await db.select()
        .from(contradictions)
        .where(eq(contradictions.id, contradiction!.id));

      expect(resolved!.status).toBe('RESOLVED');
      expect(resolved!.resolution).toBe('I changed my mind');
      expect(resolved!.resolvedAt).not.toBeNull();
    });
  });
});
