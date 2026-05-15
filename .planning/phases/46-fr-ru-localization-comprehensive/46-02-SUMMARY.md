---
phase: 46
plan: 46-02
subsystem: profile-display
tags: [L10N-01, WR-02-folded, profile-handler]
provides:
  - FR + RU localization of 21 EN-only sites in src/bot/handlers/profile.ts
  - MSG.scoreLine per-locale template (decimal-format consistency: EN dot, FR/RU comma)
  - Per-locale HEXACO + Schwartz dim-label registers (Record<Lang, string>)
requires:
  - 46-01 (src/chris/locale/strings.ts canonical qualifierFor)
affects:
  - /profile Telegram command output (cron-context: N/A — user-initiated only)
tech_stack:
  added: []
  patterns: [nested Record<Lang, T> dim labels, toFixed+replace decimal locale fix]
key_files:
  modified:
    - src/bot/handlers/profile.ts
    - src/bot/handlers/__tests__/profile-psychological.golden.test.ts
decisions:
  - Decimal-format consistency (46-PLAN-CHECK W#1): EN keeps toFixed(1) byte-identity; FR/RU use toFixed(1).replace('.', ',') — avoids toLocaleString rounding edge (0.35 → 0.4 vs prior 0.3) that would force EN snapshot regen
  - FR seed translations: standard psychological-translation conventions (Honnêteté-Humilité, Conscienciosité, Bienveillance) — Greg reviews at /gsd-verify-work per CONTEXT.md D-06
  - RU seed translations: standard Cyrillic from academic Schwartz + HEXACO references — Greg reviews at /gsd-verify-work
  - Snapshot strategy: replace stub FR/RU snapshots in Scenario 4 with localized output; add NEW snapshots for Schwartz populated + mixed in FR/RU
metrics:
  duration: ~30min
  completed: 2026-05-15
  tasks: 4 (single commit)
  files_modified: 2
---

# Phase 46 Plan 46-02: /profile psychological-section localization (L10N-01) Summary

**One-liner:** All 21 EN-only sites in `src/bot/handlers/profile.ts` ship FR + RU translations (12 dim labels + 3 qualifier strings via 46-01 import + 6 score-line tokens) with decimal-format-consistent FR/RU output (`4,2 / 5,0` not `4.2 / 5,0`); 19 golden snapshot tests cover EN baseline + FR + RU per scenario.

## Tasks Executed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| T1+T2+T3+T4 | Localize dim labels + qualifier import + scoreLine template + golden snapshots | `2ccdad1` | profile.ts, profile-psychological.golden.test.ts |

Single commit captures the four-task migration because each task in isolation would have broken either compile-time (T1 changes the value-type) or test-time (T2/T3 change formatter behavior). All four tasks are tightly coupled in dependency order; intermediate states don't compile cleanly.

## Test Results

- `profile-psychological.golden.test.ts` — 19/19 passing
  - Scenario 1 EN: HEXACO 6 dims, Schwartz 10 values, Attachment notYetActive
  - Scenario 2 EN: insufficient / never-fired branches
  - Scenario 3 EN: D-09 per-dim filter regression detector
  - Scenario 4 FR + RU (NEW): hexaco populated, schwartz populated, schwartz mixed, hexaco insufficient, attachment
- `profile.test.ts` + `profile.golden.test.ts` — 30/30 passing (operational handler / Phase 35 snapshots untouched)
- `npx tsc --noEmit` — clean

## Deviations from Plan

**Plan-check warning W#1 — Decimal-format consistency (RESOLVED).** The original plan proposed FR/RU slug `/ 5,0` with `score.toFixed(1)` value, producing the inconsistent `4.2 / 5,0` output the plan-checker flagged. Resolution implemented:
- EN: keeps `toFixed(1)` byte-identical (preserves existing snapshot)
- FR/RU: `toFixed(1).replace('.', ',')` — comma decimal value matching comma slug
- Avoids `toLocaleString` because `(0.35).toLocaleString('en-US')` rounds to `'0.4'` while the existing EN snapshot ships `'0.3'` (toFixed truncation). Using `replace` keeps EN byte-identical AND fixes FR/RU consistency.

**Plan-check warning W#4 — D-06 translation review.** Translations land in the commit message + this SUMMARY for Greg's `/gsd-verify-work` pass:

| Dim (EN) | FR | RU |
|---|---|---|
| Honesty-Humility | Honnêteté-Humilité | Честность-Скромность |
| Emotionality | Émotionnalité | Эмоциональность |
| Extraversion | Extraversion | Экстраверсия |
| Agreeableness | Amabilité | Доброжелательность |
| Conscientiousness | Conscienciosité | Добросовестность |
| Openness | Ouverture | Открытость опыту |
| Self-Direction | Autonomie | Самостоятельность |
| Stimulation | Stimulation | Стимуляция |
| Hedonism | Hédonisme | Гедонизм |
| Achievement | Accomplissement | Достижения |
| Power | Pouvoir | Власть |
| Security | Sécurité | Безопасность |
| Conformity | Conformité | Конформизм |
| Tradition | Tradition | Традиция |
| Benevolence | Bienveillance | Благожелательность |
| Universalism | Universalisme | Универсализм |
| confidence (token) | confiance | уверенность |
| substantial evidence (qualifier) | preuves substantielles | существенные данные |
| moderate evidence (qualifier) | preuves modérées | умеренные данные |
| limited evidence (qualifier) | preuves limitées | ограниченные данные |

## Verification

- `grep -c "qualifierForPsych" src/bot/handlers/profile.ts` → 0 ✓ (function removed; only comment references)
- `grep -c "MSG.scoreLine\[lang\]" src/bot/handlers/profile.ts` → 2 ✓ (hexaco + schwartz)
- `grep "Record<keyof HexacoProfileData, Record<Lang, string>>" src/bot/handlers/profile.ts | wc -l` → 1 ✓
- `grep "Record<keyof SchwartzProfileData, Record<Lang, string>>" src/bot/handlers/profile.ts | wc -l` → 1 ✓
- `grep -c "/ 5,0" src/bot/handlers/profile.ts` → 2 ✓ (FR + RU slug)
- `grep "Honnêteté-Humilité" src/bot/handlers/profile.ts` ✓
- `grep "Самостоятельность" src/bot/handlers/profile.ts` ✓
- EN snapshot bytes unchanged in profile-psychological.golden.test.ts (verified via git diff per Scenario 1+2+3)

## Self-Check: PASSED

- Commit `2ccdad1` exists in `git log` ✓
- Both modified files staged correctly ✓
- All 19 golden tests + 30 sibling profile tests + 39 psych-prompt tests pass ✓
- EN snapshot diff is empty (only the FR/RU stub snapshots in Scenario 4 + the new Schwartz FR/RU scenarios touched) ✓
