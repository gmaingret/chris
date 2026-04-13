// Audit script for Phase 6 memory audit (RETR-03)
// Compares Pensieve FACT/RELATIONSHIP entries against ground truth,
// soft-deletes incorrect entries, inserts corrected replacements with
// synchronous embeddings, and generates a markdown report.
//
// Run commands:
//   Dry-run:  DATABASE_URL="..." npx tsx src/scripts/audit-pensieve.ts --dry-run
//   Wet-run:  DATABASE_URL="..." npx tsx src/scripts/audit-pensieve.ts

import { eq, isNull, inArray, and } from 'drizzle-orm';
import * as fs from 'fs';
import { db } from '../db/connection.js';
import { pensieveEntries } from '../db/schema.js';
import { embedAndStore } from '../pensieve/embeddings.js';
import { GROUND_TRUTH_MAP } from '../pensieve/ground-truth.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditStatus = 'correct' | 'incorrect' | 'unrelated';
export type AuditAction = 'kept' | 'soft_deleted' | 'would_correct';

export interface AuditResult {
  entryId: string;
  content: string;
  status: AuditStatus;
  action: AuditAction;
  groundTruthKey?: string;
  correctedContent?: string;
}

interface MatchResult {
  matched: boolean;
  key?: string;
  isCorrect?: boolean;
  issue?: string;
}

// ── Matching logic ────────────────────────────────────────────────────────────

/**
 * Match an entry's content against ground-truth facts using keyword patterns.
 * Covers the M006 D-04 scope: location history, property, business, identity, financial.
 *
 * Returns:
 *   { matched: false } — not related to any audited fact category
 *   { matched: true, key, isCorrect: true } — correctly states the fact
 *   { matched: true, key, isCorrect: false, issue } — states an incorrect fact
 */
export function matchEntryToGroundTruth(content: string): MatchResult {
  const lower = content.toLowerCase();

  // ── Rental property ───────────────────────────────────────────────────────
  // Check if content is about the rental property context
  const isRentalContext =
    lower.includes('rented') ||
    lower.includes('rental') ||
    lower.includes('apartment') ||
    lower.includes('managed by citya') ||
    lower.includes('managed by citya') ||
    (lower.includes('citya') && (lower.includes('managed') || lower.includes('rented') || lower.includes('apartment')));

  if (isRentalContext) {
    const hasCagnesSurMer = lower.includes('cagnes-sur-mer');
    const hasGolfeJuan = lower.includes('golfe-juan');

    if (hasCagnesSurMer && !hasGolfeJuan) {
      // Content says rental is in Cagnes-sur-Mer, but ground truth says Golfe-Juan
      return {
        matched: true,
        key: 'rental_property',
        isCorrect: false,
        issue: `Rental property incorrectly stated as Cagnes-sur-Mer (ground truth: Golfe-Juan, France)`,
      };
    }

    if (hasGolfeJuan) {
      return {
        matched: true,
        key: 'rental_property',
        isCorrect: true,
      };
    }
  }

  // ── Move direction error ───────────────────────────────────────────────────
  // "from Georgia to Saint Petersburg" is inverted — Greg moves FROM Saint Petersburg TO Georgia
  const wrongDirection =
    (lower.includes('from georgia') || lower.includes('from batumi')) &&
    (lower.includes('to saint petersburg') ||
      lower.includes('to st. petersburg') ||
      lower.includes('to st petersburg'));

  if (wrongDirection) {
    return {
      matched: true,
      key: 'current_location',
      isCorrect: false,
      issue: `Wrong move direction: content says moving from Georgia to Saint Petersburg, but Greg moves from Saint Petersburg to Georgia`,
    };
  }

  // ── Current location (correct) ────────────────────────────────────────────
  const correctLocationPattern =
    lower.includes('saint petersburg') &&
    !wrongDirection &&
    (lower.includes('currently') ||
      lower.includes('living in') ||
      lower.includes('leave') ||
      lower.includes('april 28') ||
      lower.includes('until'));

  if (correctLocationPattern) {
    return {
      matched: true,
      key: 'current_location',
      isCorrect: true,
    };
  }

  // ── Next move to Batumi ───────────────────────────────────────────────────
  if (
    lower.includes('batumi') &&
    (lower.includes('move') ||
      lower.includes('moving') ||
      lower.includes('heading') ||
      lower.includes('going to') ||
      lower.includes('relocate'))
  ) {
    return {
      matched: true,
      key: 'next_move',
      isCorrect: true,
    };
  }

  // ── Antibes / after Batumi ─────────────────────────────────────────────────
  if (lower.includes('antibes') && (lower.includes('batumi') || lower.includes('summer') || lower.includes('june') || lower.includes('august'))) {
    return {
      matched: true,
      key: 'after_batumi',
      isCorrect: true,
    };
  }

  // ── Permanent relocation to Batumi ────────────────────────────────────────
  if (
    lower.includes('batumi') &&
    (lower.includes('permanent') || lower.includes('september 2026') || lower.includes('permanently'))
  ) {
    return {
      matched: true,
      key: 'permanent_relocation',
      isCorrect: true,
    };
  }

  // ── Identity — birth date ─────────────────────────────────────────────────
  if (lower.includes('born') || lower.includes('birth')) {
    const hasCorrectDate =
      lower.includes('june 15, 1979') ||
      lower.includes('june 15 1979') ||
      lower.includes('1979-06-15') ||
      lower.includes('15 june 1979') ||
      lower.includes('15/06/1979');

    const hasWrongDate = lower.includes('1979') && !hasCorrectDate && /\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(lower);

    if (hasCorrectDate) {
      return { matched: true, key: 'birth_date', isCorrect: true };
    }
    if (hasWrongDate) {
      return {
        matched: true,
        key: 'birth_date',
        isCorrect: false,
        issue: `Incorrect birth date (ground truth: 1979-06-15)`,
      };
    }
    // Birth content without wrong date — treat as correct/related
    if (lower.includes('cagnes-sur-mer') && lower.includes('born')) {
      return { matched: true, key: 'birth_place', isCorrect: true };
    }
  }

  // ── Nationality ───────────────────────────────────────────────────────────
  if (lower.includes('french') && (lower.includes('nationality') || lower.includes('born') || lower.includes("i'm french") || lower.includes('i am french'))) {
    return { matched: true, key: 'nationality', isCorrect: true };
  }

  // ── Business entities ─────────────────────────────────────────────────────
  if (lower.includes('maingret llc') || lower.includes('maingret, llc')) {
    const correctState = lower.includes('new mexico');
    if (correctState) {
      return { matched: true, key: 'business_us', isCorrect: true };
    }
    return {
      matched: true,
      key: 'business_us',
      isCorrect: false,
      issue: `MAINGRET LLC state not matching ground truth (New Mexico)`,
    };
  }

  if (lower.includes('georgian individual entrepreneur') || lower.includes('georgian ie') || (lower.includes('georgian') && lower.includes('entrepreneur'))) {
    return { matched: true, key: 'business_georgia', isCorrect: true };
  }

  if (lower.includes('panama') && lower.includes('residency')) {
    const correct = lower.includes('permanent');
    return {
      matched: true,
      key: 'residency_panama',
      isCorrect: correct,
      ...(correct ? {} : { issue: 'Panama residency type not confirmed as permanent' }),
    };
  }

  // ── Financial — FI target ─────────────────────────────────────────────────
  if (lower.includes('fi target') || lower.includes('financial independence') || (lower.includes('1.5 million') || lower.includes('$1,500,000') || lower.includes('1,500,000'))) {
    return { matched: true, key: 'fi_target', isCorrect: true };
  }

  // ── Rental manager ────────────────────────────────────────────────────────
  if (lower.includes('citya') && (lower.includes('managed') || lower.includes('manage') || lower.includes('since october'))) {
    return { matched: true, key: 'rental_manager', isCorrect: true };
  }

  return { matched: false };
}

// ── Corrected content generation ──────────────────────────────────────────────

/**
 * Generate a corrected content string for an incorrect entry.
 * Format: "[Audit correction] {key}: {correct value}"
 */
export function generateCorrectedContent(key: string, _originalContent: string): string {
  const correctValue = GROUND_TRUTH_MAP[key];
  if (!correctValue) {
    return `[Audit correction] ${key}: (unknown ground truth key)`;
  }
  return `[Audit correction] ${key}: ${correctValue}`;
}

// ── Report generation ─────────────────────────────────────────────────────────

/**
 * Generate a markdown audit report per D-05.
 * Includes header, date, summary stats, and a table of all reviewed entries.
 */
export function formatAuditReport(results: AuditResult[], isDryRun: boolean): string {
  const now = new Date().toISOString();
  const total = results.length;
  const correct = results.filter((r) => r.status === 'correct').length;
  const incorrect = results.filter((r) => r.status === 'incorrect').length;
  const unrelated = results.filter((r) => r.status === 'unrelated').length;
  const corrections = results.filter((r) => r.action === 'soft_deleted' || r.action === 'would_correct').length;

  const runMode = isDryRun ? 'dry-run (no mutations)' : 'wet-run (mutations applied)';

  const lines: string[] = [
    '# Pensieve Audit Report',
    '',
    `**Date:** ${now}`,
    `**Mode:** ${runMode}`,
    '',
    '## Summary',
    '',
    `- **Total reviewed:** ${total}`,
    `- **Correct:** ${correct}`,
    `- **Incorrect:** ${incorrect}`,
    `- **Unrelated:** ${unrelated}`,
    `- **Corrections ${isDryRun ? 'identified' : 'applied'}:** ${corrections}`,
    '',
    '## Entry Details',
    '',
    '| Entry ID | Content | Status | Action | Ground Truth Key |',
    '|----------|---------|--------|--------|------------------|',
  ];

  for (const result of results) {
    const shortId = result.entryId.slice(0, 8);
    const shortContent = result.content.slice(0, 80).replace(/\|/g, '\\|');
    const key = result.groundTruthKey ?? '-';
    lines.push(`| ${shortId} | ${shortContent} | ${result.status} | ${result.action} | ${key} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push(`*Report generated in **${isDryRun ? 'dry-run' : 'wet-run'}** mode. ${isDryRun ? 'No changes were made to the database.' : 'Incorrect entries have been soft-deleted and corrected replacements inserted.'}*`);
  lines.push('');

  return lines.join('\n');
}

// ── Main audit function ────────────────────────────────────────────────────────

export async function auditPensieve(options: {
  dryRun: boolean;
  reportPath: string;
}): Promise<{ results: AuditResult[]; mutationCount: number }> {
  // Query all FACT/RELATIONSHIP entries that are not soft-deleted
  const entries = await db
    .select()
    .from(pensieveEntries)
    .where(
      and(
        isNull(pensieveEntries.deletedAt),
        inArray(pensieveEntries.epistemicTag, ['FACT', 'RELATIONSHIP']),
      ),
    );

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

    // matched AND incorrect
    const correctedContent = generateCorrectedContent(match.key!, entry.content);

    if (options.dryRun) {
      results.push({
        entryId: entry.id,
        content: entry.content,
        status: 'incorrect',
        action: 'would_correct',
        groundTruthKey: match.key,
        correctedContent,
      });
    } else {
      // Soft-delete the incorrect entry (D-01 / D004 — never hard DELETE)
      await db
        .update(pensieveEntries)
        .set({ deletedAt: new Date() })
        .where(eq(pensieveEntries.id, entry.id));

      // Insert corrected replacement with source='audit' and epistemicTag='FACT' (D-02)
      const [corrected] = await db
        .insert(pensieveEntries)
        .values({
          content: correctedContent,
          epistemicTag: 'FACT',
          source: 'audit',
          metadata: {
            auditCorrectedFrom: entry.id,
            groundTruthKey: match.key,
          },
        })
        .returning();

      if (corrected) {
        // Synchronous embedding per D-02 — not fire-and-forget for audit entries
        await embedAndStore(corrected.id, correctedContent);
      }

      mutationCount++;

      results.push({
        entryId: entry.id,
        content: entry.content,
        status: 'incorrect',
        action: 'soft_deleted',
        groundTruthKey: match.key,
        correctedContent,
      });
    }
  }

  // Write markdown report (D-05)
  const report = formatAuditReport(results, options.dryRun);
  fs.writeFileSync(options.reportPath, report, 'utf-8');

  return { results, mutationCount };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  // Parse optional --report-path <path>
  let reportPath = '.planning/phases/06-memory-audit/audit-report.md';
  const reportPathIdx = args.indexOf('--report-path');
  if (reportPathIdx !== -1 && args[reportPathIdx + 1]) {
    reportPath = args[reportPathIdx + 1]!;
  }

  if (!isDryRun) {
    console.log('Loading bge-m3 embedding model...');
  }

  console.log(`Starting Pensieve audit (${isDryRun ? 'dry-run' : 'wet-run'})...`);

  const { results, mutationCount } = await auditPensieve({ dryRun: isDryRun, reportPath });

  const corrections = isDryRun
    ? results.filter((r) => r.action === 'would_correct').length
    : mutationCount;

  console.log(
    `Audit complete: ${results.length} entries reviewed, ${corrections} corrections ${isDryRun ? 'identified (dry-run)' : 'applied'}`,
  );
  console.log(`Report written to: ${reportPath}`);

  process.exit(0);
}

// Only run when executed directly
const isMainModule =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('audit-pensieve.ts') ||
    process.argv[1].endsWith('audit-pensieve.js'));

if (isMainModule) {
  main().catch((err) => {
    console.error('Audit script failed:', err);
    process.exit(1);
  });
}
