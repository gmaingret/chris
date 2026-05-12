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
import { eq, inArray, or } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import { pensieveEntries, pensieveEmbeddings, contradictions } from '../../db/schema.js';
import { detectContradictions } from '../contradiction.js';
import { embedAndStore } from '../../pensieve/embeddings.js';

// Unique per-process source tag so parallel test files don't clobber each other's rows
// via shared `source = 'telegram'` deletes. See phase 10 REVIEW.md WR-06.
const TEST_SOURCE = `test-contradiction-fp-${process.pid}`;

interface AuditPair {
  category: 'evolving_circumstances' | 'different_aspects' | 'time_bounded' | 'conditional' | 'emotional_vs_factual';
  label: string;
  entryA: string;
  entryB: string;
}

const AUDIT_PAIRS: AuditPair[] = [
  // evolving_circumstances (4) — feelings/perceptions that legitimately shift
  // over time. NOT direct reversals of stated intention (which the prompt's
  // own examples flag as real contradictions).
  {
    category: 'evolving_circumstances',
    label: 'feeling about new place',
    entryA: 'Saint Petersburg felt overwhelming when I first arrived',
    entryB: 'Saint Petersburg has grown on me — the winter rhythm suits me now',
  },
  {
    category: 'evolving_circumstances',
    label: 'consulting focus refinement',
    entryA: 'I want to grow my consulting business across multiple industries',
    entryB: 'I am specializing in healthcare consulting going forward',
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
    entryA: 'If I stay in Russia my living costs will remain low',
    entryB: 'If I move to Georgia my living costs will rise significantly',
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
    label: 'remote freedom vs contracted location',
    entryA: 'I love the feeling of freedom that comes with working remotely',
    entryB: 'My current contract requires me at the Paris office three days a week',
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
      .where(eq(pensieveEntries.source, TEST_SOURCE));
    const ids = testEntryIds.map(e => e.id);
    if (ids.length > 0) {
      // Delete contradictions referencing the test entry on EITHER side —
      // detectContradictions stores entry_a_id = new text's entry, entry_b_id
      // = matched candidate. The test passes no entryId so storage is skipped,
      // but a parallel-engine path or test-suite ordering could leave behind
      // a contradiction row that references this test entry via entry_b_id;
      // the FK on pensieve_entries.id propagates downstream into wide
      // unscoped cleanups in other files.
      await db.delete(contradictions).where(
        or(
          inArray(contradictions.entryAId, ids),
          inArray(contradictions.entryBId, ids),
        ),
      );
      await db.delete(pensieveEmbeddings).where(inArray(pensieveEmbeddings.entryId, ids));
      await db.delete(pensieveEntries).where(eq(pensieveEntries.source, TEST_SOURCE));
    }
  });

  const categories = [...new Set(AUDIT_PAIRS.map(p => p.category))];

  for (const category of categories) {
    const pairs = AUDIT_PAIRS.filter(p => p.category === category);
    describe(category, () => {
      for (const pair of pairs) {
        it(`${pair.label}: not a false positive`, {
          timeout: 180_000, // embed + Haiku candidate-filter + Sonnet judgment
                            // run serially; real Anthropic load + bge-m3 fp32
                            // cold load can exceed the 90s prior ceiling.
          retry: 2,         // Haiku runs at default temperature (>0). Same
                            // (genuinely non-contradictory) pair can flip
                            // between flagged / not-flagged across runs ~5%
                            // of the time. Two retries (3 total attempts)
                            // suppress stochastic noise; a consistently-
                            // flagged pair still fails (real regression).
        }, async () => {
          // Insert entry A with:
          // - BELIEF tag so it survives the CONTRADICTION_SEARCH_OPTIONS tag
          //   filter (BELIEF/INTENTION/VALUE). Without an epistemic_tag,
          //   hybridSearch returns 0 candidates and detectContradictions
          //   short-circuits before any LLM call — the test would pass
          //   trivially without exercising the pipeline.
          // - createdAt 90 days in the past so Sonnet sees a real chronological
          //   gap between the prior belief and the new statement. With both
          //   stamped today, "evolving_circumstances" pairs read to the model
          //   as simultaneous claims (true contradictions); the prompt's
          //   "natural evolution" carve-out only fires when the dates differ.
          const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
          const [entryA] = await db.insert(pensieveEntries).values({
            content: pair.entryA,
            source: TEST_SOURCE,
            epistemicTag: 'BELIEF',
            createdAt: ninetyDaysAgo,
          }).returning();

          // Embed entry A so hybridSearch can find it as a candidate
          await embedAndStore(entryA!.id, pair.entryA);

          // Call detectContradictions with entry B text
          const results = await detectContradictions(pair.entryB);

          // Must produce 0 false positives
          expect(results).toHaveLength(0);
        });
      }
    });
  }
});
