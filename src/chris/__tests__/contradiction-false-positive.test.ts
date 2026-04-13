/**
 * Contradiction false-positive audit (TEST-09).
 * Requires a real ANTHROPIC_API_KEY and a running Postgres database.
 *
 * Verifies that 20 adversarial non-contradictory pairs produce 0 false positives
 * from the contradiction detection pipeline (D-33).
 *
 * Run: DATABASE_URL=... ANTHROPIC_API_KEY=... npx vitest run src/chris/__tests__/contradiction-false-positive.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import { pensieveEntries, pensieveEmbeddings, contradictions } from '../../db/schema.js';
import { detectContradictions } from '../contradiction.js';
import { embedAndStore } from '../../pensieve/embeddings.js';

interface AuditPair {
  category: 'evolving_circumstances' | 'different_aspects' | 'time_bounded' | 'conditional' | 'emotional_vs_factual';
  label: string;
  entryA: string;
  entryB: string;
}

const AUDIT_PAIRS: AuditPair[] = [
  // evolving_circumstances (4)
  {
    category: 'evolving_circumstances',
    label: 'stay duration change',
    entryA: 'I want to leave Saint Petersburg by end of April',
    entryB: 'I decided to extend my stay in Saint Petersburg by 2 weeks',
  },
  {
    category: 'evolving_circumstances',
    label: 'career pivot',
    entryA: 'I am focused on growing my consulting business',
    entryB: 'I am transitioning away from consulting to focus on product development',
  },
  {
    category: 'evolving_circumstances',
    label: 'diet change',
    entryA: 'I have been eating mostly vegetarian lately',
    entryB: 'I started incorporating meat back into my diet this week',
  },
  {
    category: 'evolving_circumstances',
    label: 'exercise routine change',
    entryA: 'I run every morning at 7am',
    entryB: 'I switched to evening runs because mornings are too cold now',
  },

  // different_aspects (4)
  {
    category: 'different_aspects',
    label: 'running benefits vs downsides',
    entryA: 'Running clears my head and helps me think',
    entryB: 'Running is destroying my knees and I need to be careful',
  },
  {
    category: 'different_aspects',
    label: 'city pros vs cons',
    entryA: 'Saint Petersburg has amazing architecture and culture',
    entryB: 'Saint Petersburg weather is depressing and grey most of the year',
  },
  {
    category: 'different_aspects',
    label: 'remote work tradeoffs',
    entryA: 'Working remotely gives me incredible freedom',
    entryB: 'Working remotely can be isolating and lonely',
  },
  {
    category: 'different_aspects',
    label: 'freelancing tradeoffs',
    entryA: 'Freelancing lets me choose my own projects',
    entryB: 'Freelancing income is unpredictable and stressful',
  },

  // time_bounded (4)
  {
    category: 'time_bounded',
    label: 'income growth',
    entryA: 'In 2023 I was earning around 8000 dollars per month',
    entryB: 'Now in 2026 I am targeting 15000 dollars per month',
  },
  {
    category: 'time_bounded',
    label: 'living situation',
    entryA: 'Last year I was living in Antibes full time',
    entryB: 'This year I am based in Saint Petersburg',
  },
  {
    category: 'time_bounded',
    label: 'project focus',
    entryA: 'In January I was working on the billing system',
    entryB: 'In March I shifted focus entirely to the AI assistant project',
  },
  {
    category: 'time_bounded',
    label: 'relationship status',
    entryA: 'In 2022 I was single and focused on work',
    entryB: 'In 2024 I started a new relationship',
  },

  // conditional (4)
  {
    category: 'conditional',
    label: 'cost of living tradeoff',
    entryA: 'If I stay in Russia I will keep my costs very low',
    entryB: 'Moving to Georgia will increase my living costs significantly',
  },
  {
    category: 'conditional',
    label: 'career path options',
    entryA: 'If I get the enterprise client I will hire a team',
    entryB: 'If the deal falls through I will stay solo and keep overhead low',
  },
  {
    category: 'conditional',
    label: 'travel plans',
    entryA: 'If the visa comes through I will go to Thailand in summer',
    entryB: 'If the visa is delayed I will stay in Georgia through summer',
  },
  {
    category: 'conditional',
    label: 'investment strategy',
    entryA: 'If the market crashes I will buy more index funds',
    entryB: 'If the market keeps going up I will hold and not add more',
  },

  // emotional_vs_factual (4)
  {
    category: 'emotional_vs_factual',
    label: 'home feeling vs legal residence',
    entryA: 'Antibes feels like home to me',
    entryB: 'My legal residence is registered in Panama',
  },
  {
    category: 'emotional_vs_factual',
    label: 'work passion vs reality',
    entryA: 'I love the idea of building products',
    entryB: 'Most of my revenue comes from consulting not products',
  },
  {
    category: 'emotional_vs_factual',
    label: 'city attachment vs plans',
    entryA: 'I feel deeply connected to Saint Petersburg',
    entryB: 'I am leaving Saint Petersburg at the end of April',
  },
  {
    category: 'emotional_vs_factual',
    label: 'freedom vs structure',
    entryA: 'I crave total freedom and no obligations',
    entryB: 'I have signed a 6-month contract with a client',
  },
];

describe.skipIf(!process.env.ANTHROPIC_API_KEY)('Contradiction false-positive audit (TEST-09)', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    // FK-safe cleanup order, scoped to test-inserted rows only
    const testEntryIds = await db
      .select({ id: pensieveEntries.id })
      .from(pensieveEntries)
      .where(eq(pensieveEntries.source, 'telegram'));
    const ids = testEntryIds.map(e => e.id);
    if (ids.length > 0) {
      await db.delete(contradictions).where(inArray(contradictions.entryAId, ids));
      await db.delete(pensieveEmbeddings).where(inArray(pensieveEmbeddings.entryId, ids));
      await db.delete(pensieveEntries).where(eq(pensieveEntries.source, 'telegram'));
    }
  });

  const categories = [...new Set(AUDIT_PAIRS.map(p => p.category))];

  for (const category of categories) {
    const pairs = AUDIT_PAIRS.filter(p => p.category === category);
    describe(category, () => {
      for (const pair of pairs) {
        it(`${pair.label}: not a false positive`, async () => {
          // Insert entry A
          const [entryA] = await db.insert(pensieveEntries).values({
            content: pair.entryA,
            source: 'telegram',
          }).returning();

          // Embed entry A so hybridSearch can find it as a candidate
          await embedAndStore(entryA!.id, pair.entryA);

          // Call detectContradictions with entry B text
          const results = await detectContradictions(pair.entryB);

          // Must produce 0 false positives
          expect(results).toHaveLength(0);
        }, 30_000);
      }
    });
  }
});
