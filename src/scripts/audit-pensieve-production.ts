// Production audit adapter for Phase 6 memory audit (RETR-03)
// The production DB uses table "memories" (no deleted_at column),
// while the local schema uses "pensieve_entries" (with deleted_at).
// This script queries production directly via raw SQL and uses
// the same matching/reporting logic from audit-pensieve.ts.

import postgres from 'postgres';
import * as fs from 'fs';
import { matchEntryToGroundTruth, generateCorrectedContent, formatAuditReport } from './audit-pensieve.js';
import type { AuditResult } from './audit-pensieve.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  let reportPath = '.planning/phases/06-memory-audit/audit-report-production.md';
  const reportPathIdx = args.indexOf('--report-path');
  if (reportPathIdx !== -1 && args[reportPathIdx + 1]) {
    reportPath = args[reportPathIdx + 1]!;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = postgres(databaseUrl);

  try {
    console.log(`Starting production Pensieve audit (${isDryRun ? 'dry-run' : 'wet-run'})...`);

    // Query production "memories" table (no deleted_at column)
    const entries = await sql`
      SELECT id, content, epistemic_tag, source, metadata, created_at
      FROM memories
      WHERE epistemic_tag IN ('FACT', 'RELATIONSHIP')
      ORDER BY created_at
    `;

    const results: AuditResult[] = [];
    let mutationCount = 0;

    for (const entry of entries) {
      const match = matchEntryToGroundTruth(entry.content);

      if (!match.matched) {
        results.push({
          entryId: entry.id,
          content: entry.content,
          status: 'unrelated',
          action: 'kept',
        });
        continue;
      }

      if (match.isCorrect) {
        results.push({
          entryId: entry.id,
          content: entry.content,
          status: 'correct',
          action: 'kept',
          groundTruthKey: match.key,
        });
        continue;
      }

      // Matched AND incorrect
      if (!match.key) {
        console.error(`BUG: matched entry ${entry.id} has no ground-truth key — skipping`);
        continue;
      }
      const correctedContent = generateCorrectedContent(match.key, entry.content);

      if (isDryRun) {
        results.push({
          entryId: entry.id,
          content: entry.content,
          status: 'incorrect',
          action: 'would_correct',
          groundTruthKey: match.key,
          correctedContent,
        });
      } else {
        // Production "memories" has no deleted_at — use UPDATE to mark content as superseded
        // Add [SUPERSEDED] prefix and store audit metadata
        let existingMetadata: Record<string, unknown> = {};
        try {
          existingMetadata = typeof entry.metadata === 'string'
            ? JSON.parse(entry.metadata || '{}')
            : (entry.metadata || {});
        } catch {
          existingMetadata = {};
        }

        await sql`
          UPDATE memories
          SET content = ${'[SUPERSEDED by audit] ' + entry.content},
              metadata = ${JSON.stringify({
                ...existingMetadata,
                auditSuperseded: true,
                auditDate: new Date().toISOString(),
              })}
          WHERE id = ${entry.id}::uuid
        `;

        // Insert corrected replacement
        const [corrected] = await sql`
          INSERT INTO memories (content, epistemic_tag, source, metadata)
          VALUES (
            ${correctedContent},
            'FACT',
            'audit',
            ${JSON.stringify({
              auditCorrectedFrom: entry.id,
              groundTruthKey: match.key,
            })}
          )
          RETURNING id
        `;

        mutationCount++;

        results.push({
          entryId: entry.id,
          content: entry.content,
          status: 'incorrect',
          action: 'soft_deleted',
          groundTruthKey: match.key,
          correctedContent,
        });

        if (corrected) {
          console.log(`  Corrected: ${entry.id.substring(0, 8)} → ${corrected.id.substring(0, 8)} (${match.key})`);
        }
      }
    }

    // Write report
    const report = formatAuditReport(results, isDryRun);
    fs.writeFileSync(reportPath, report, 'utf-8');

    const corrections = isDryRun
      ? results.filter((r) => r.action === 'would_correct').length
      : mutationCount;

    console.log(
      `Audit complete: ${results.length} entries reviewed, ${corrections} corrections ${isDryRun ? 'identified (dry-run)' : 'applied'}`,
    );
    console.log(`Report written to: ${reportPath}`);

    process.exit(0);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Production audit failed:', err);
  process.exit(1);
});
