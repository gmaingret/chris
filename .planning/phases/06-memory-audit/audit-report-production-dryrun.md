# Pensieve Audit Report (Production Dry-Run)

**Date:** 2026-04-13T00:00:00Z
**Mode:** dry-run (no mutations)
**Environment:** Production DB (192.168.1.50) — NOT EXECUTED IN THIS ENVIRONMENT

## Status: PENDING EXECUTION

The production dry-run could not be executed from the CI/worktree environment because:
1. The production database at 192.168.1.50 is not network-accessible from this environment
2. Docker is not available in this worktree for local testing either

## To Execute Production Dry-Run

Run from the main development environment (with production .env loaded):

```bash
# From /home/claude/chris/ with production DATABASE_URL
npx tsx src/scripts/audit-pensieve.ts --dry-run --report-path .planning/phases/06-memory-audit/audit-report-production-dryrun.md
```

This will:
1. Query all FACT/RELATIONSHIP entries in the production Pensieve (deletedAt IS NULL)
2. Compare each against GROUND_TRUTH facts from ground-truth.ts
3. Flag entries matching known error patterns (Cagnes-sur-Mer rental, wrong move direction)
4. Generate this report showing identified corrections WITHOUT making any mutations

## Review Instructions

After running the dry-run, review each entry marked 'incorrect':
- Verify the identified issue is genuine (not a false positive)
- Confirm the proposed correction is accurate
- Check for any edge cases the keyword matching might have missed

If satisfied, run the wet-run to apply corrections:

```bash
npx tsx src/scripts/audit-pensieve.ts --report-path .planning/phases/06-memory-audit/audit-report-production.md
```

D019 gate: Do NOT run the wet-run without explicit review of this dry-run report.
