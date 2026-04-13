// Seed script for memory audit (Phase 6 D-06)
// Inserts realistic Pensieve entries (correct + incorrect) into a local Docker Postgres DB.
// Covers all M006 ground-truth categories with the known error patterns.
//
// Run command:
//   DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx tsx src/scripts/seed-audit-data.ts

import { db } from '../db/connection.js';
import { pensieveEntries } from '../db/schema.js';
import { embedAndStore } from '../pensieve/embeddings.js';

// ── Seed data type ─────────────────────────────────────────────────────────

export interface SeedEntry {
  content: string;
  epistemicTag: 'FACT' | 'RELATIONSHIP';
  source: 'telegram';
  metadata: {
    seedScenario: 'correct' | 'error';
    groundTruthKey?: string;
    errorDescription?: string;
  };
}

// ── Seed entries ───────────────────────────────────────────────────────────

/**
 * Exported so unit tests can validate the data structure without needing a DB.
 *
 * 10 correct + 2 error entries = 12 total, covering all 5 ground-truth categories.
 */
export const SEED_ENTRIES: SeedEntry[] = [
  // ── identity ──────────────────────────────────────────────────────────────
  {
    content: 'I was born on June 15, 1979 in Cagnes-sur-Mer.',
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'correct', groundTruthKey: 'birth_date' },
  },
  {
    content: "I'm French, born and raised.",
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'correct', groundTruthKey: 'nationality' },
  },

  // ── location_history ──────────────────────────────────────────────────────
  {
    content:
      "I'm currently living in Saint Petersburg, Russia. Planning to leave around April 28.",
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'correct', groundTruthKey: 'current_location' },
  },
  {
    content:
      "After a month in Batumi, I'll head to Antibes for the summer, June through August.",
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'correct', groundTruthKey: 'after_batumi' },
  },
  {
    content: 'The plan is to permanently relocate to Batumi around September 2026.',
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'correct', groundTruthKey: 'permanent_relocation' },
  },

  // ── property ──────────────────────────────────────────────────────────────
  {
    content: 'My rental property in Golfe-Juan has been managed by Citya since October 2022.',
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'correct', groundTruthKey: 'rental_property' },
  },

  // ── business ──────────────────────────────────────────────────────────────
  {
    content: 'I run MAINGRET LLC registered in New Mexico.',
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'correct', groundTruthKey: 'business_us' },
  },
  {
    content: 'I also have a Georgian Individual Entrepreneur registration.',
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'correct', groundTruthKey: 'business_georgia' },
  },
  {
    content: 'I have Panama permanent residency.',
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'correct', groundTruthKey: 'residency_panama' },
  },

  // ── financial ─────────────────────────────────────────────────────────────
  {
    content: 'My FI target is $1.5 million.',
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'correct', groundTruthKey: 'fi_target' },
  },

  // ── ERROR ENTRIES — these are the known M006 error patterns ───────────────

  // Error 1: Cagnes-sur-Mer used as rental property location (correct: Golfe-Juan)
  {
    content: 'My apartment in Cagnes-sur-Mer is rented out through Citya.',
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: {
      seedScenario: 'error',
      groundTruthKey: 'rental_property',
      errorDescription: 'Rental property is in Golfe-Juan, not Cagnes-sur-Mer',
    },
  },

  // Error 2: Wrong move direction (from Georgia to Saint Petersburg — inverted)
  {
    content: "I'm planning to move from Georgia to Saint Petersburg next month.",
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: {
      seedScenario: 'error',
      groundTruthKey: 'current_location',
      errorDescription: 'Wrong direction — moving FROM Saint Petersburg TO Georgia, not the reverse',
    },
  },
];

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Safety guard (Pitfall 5) — refuse to run against a non-local DB
  const dbUrl = process.env['DATABASE_URL'] ?? '';
  if (
    !dbUrl.startsWith('postgresql://') ||
    (!dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1'))
  ) {
    console.error(
      'ERROR: DATABASE_URL must point to a localhost database (port 5433 local Docker).\n' +
        'Refusing to run seed against a non-local DB.\n' +
        'Set: DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris"',
    );
    process.exit(1);
  }

  console.log(`Seeding ${SEED_ENTRIES.length} Pensieve entries into local DB...`);

  // Log model load warning before first embed (Pitfall 3)
  console.log('Loading bge-m3 embedding model...');

  let insertedCount = 0;

  for (const entry of SEED_ENTRIES) {
    // Insert directly via Drizzle (not storePensieveEntry) to set epistemicTag synchronously
    // (Pitfall 1: storePensieveEntry has no epistemicTag param)
    const [inserted] = await db
      .insert(pensieveEntries)
      .values({
        content: entry.content,
        epistemicTag: entry.epistemicTag,
        source: entry.source,
        metadata: entry.metadata,
      })
      .returning();

    if (!inserted) {
      console.error(`Failed to insert entry: ${entry.content.slice(0, 50)}`);
      continue;
    }

    // Generate embedding synchronously (Pitfall 2: not fire-and-forget for seed entries)
    await embedAndStore(inserted.id, inserted.content);

    insertedCount++;
    console.log(
      `  [${entry.metadata.seedScenario.toUpperCase()}] Inserted: ${entry.content.slice(0, 60)}...`,
    );
  }

  console.log(`\nDone. Inserted ${insertedCount} of ${SEED_ENTRIES.length} entries.`);
  process.exit(0);
}

// Only run when executed directly (not when imported by tests)
// ESM equivalent of `if (require.main === module)`
const isMainModule =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('seed-audit-data.ts') ||
    process.argv[1].endsWith('seed-audit-data.js'));

if (isMainModule) {
  main().catch((err) => {
    console.error('Seed script failed:', err);
    process.exit(1);
  });
}
