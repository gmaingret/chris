---
phase: 41-adjustment-dialogue-rework
plan: 02
subsystem: rituals
tags:
  - rituals
  - adjustment-dialogue
  - localization
  - security
  - integration-test
requirements: [ADJ-03, ADJ-05, ADJ-06, ADJ-07]
files_modified:
  - src/rituals/adjustment-dialogue.ts
files_created:
  - src/rituals/__tests__/adjustment-dialogue-no-refire.test.ts
depends_on:
  - 41-01
key-decisions:
  - "Remove mute_until from v3+v4 Haiku field enums; do NOT add adjustment_mute_until as replacement (D-41-06)"
  - "Candidate-config in-memory parse via existing RitualConfigSchema as the ADJ-06 gate (D-41-07)"
  - "Suppress REJECT_ERROR_MSG sendMessage when actor='auto_apply_on_timeout' (PLAN-CHECK WARNING-3)"
  - "confirmConfigPatch resolves locale internally via getLastUserLanguageFromDb — no signature extension (PLAN-CHECK WARNING-4)"
  - "Locale-agnostic Haiku judge prompt with one example per language per class (BL-03)"
metrics:
  duration: 18_minutes
  completed_date: "2026-05-15"
  task_count: 3
  file_count: 2
---

# Phase 41 Plan 02: Localization + Security + Per-Field Validation + Test Gate

**One-liner:** Layer FR/RU + privilege-escalation closure + per-field validation + regression test on top of Plan 41-01's EN-only live-fix.

## What was built

Three tasks: ADJ-05 enum tighten + ADJ-06 candidate-parse + ADJ-03 locale wiring across 8 sites + Haiku prompt rewrite + ADJ-07 5-case integration test.

### Task 1 — Tighten whitelist + candidate-parse gate
- Dropped `'mute_until'` from BOTH `AdjustmentClassificationSchema` (v3) and `AdjustmentClassificationSchemaV4` (v4) `proposed_change.field` enums. Both v3 and v4 now reject `'mute_until'` at the SDK boundary (T-41-02-01 mitigation).
- `confirmConfigPatch`: candidate-parse gate via `parseRitualConfig(candidate)` BEFORE jsonb_set. On ZodError → log `chris.adjustment.config_patch.invalid_type` + insert `ritual_config_events` with `patch.kind='rejected'` + locale-aware `REJECT_ERROR_MSG` sendMessage (suppressed on `auto_apply_on_timeout` per WARNING-3) + return. NO jsonb_set, NO config_invalid downstream.
- Locale resolved internally in `confirmConfigPatch` via `getLastUserLanguageFromDb(BigInt(config.telegramAuthorizedUserId))` per WARNING-4. Signature unchanged.

### Task 2 — FR/RU localization across 8 sites + Haiku prompt

**Locale wiring:**
- Imports added: `detectLanguage`, `getLastUserLanguage`, `getLastUserLanguageFromDb`, `setLastUserLanguage`, `langOf`, `type Lang` from `../chris/language.js`.
- `fireAdjustmentDialogue` (cron-context): `langOf(await getLastUserLanguageFromDb(chatId))` BEFORE messageText composition.
- `handleAdjustmentReply` / `handleConfirmationReply` (reply-side): `detectLanguage(text, getLastUserLanguage(chatIdStr))` → `setLastUserLanguage` → `langOf`.
- `routeRefusal`: accepts `locale: Lang` parameter (closed local function, no external callers).
- `queueConfigPatchConfirmation`: accepts `locale: Lang` parameter.

**Seven Record<Lang, ...> maps** (8th = REJECT_ERROR_MSG from Task 1):
- `OBSERVATIONAL_PROMPT(name)` — fire-side observational prompt
- `HARD_DISABLE_ACK` — routeRefusal hard_disable branch
- `NOT_NOW_ACK` — routeRefusal not_now branch
- `AUTO_PAUSE_MSG(name, dateISO)` — evasive→auto_pause branch (now includes displayName for FR/RU naturalness — additive over Plan 41-01 EN)
- `APPLIED_ACK(fieldLbl, newValue)` — handleConfirmationReply yes-branch
- `KEPT_ACK(fieldLbl)` — handleConfirmationReply no-branch
- `CONFIRM_ECHO(fieldLbl, newValue)` — queueConfigPatchConfirmation echo

**Haiku judge prompt rewrite (ADJ-03 explicit / BL-03):**
Locale-agnostic prompt that tells Haiku the reply may be EN/FR/RU, with one example per language per classification class. Field list `(one of: fire_at, fire_dow, skip_threshold)` synced with the post-ADJ-05 enum.

### Task 3 — Integration test (NEW)

`src/rituals/__tests__/adjustment-dialogue-no-refire.test.ts` — 5 cases under `describe('Phase 41 ADJ-07 — no re-fire after completion')`:

| Case | Path | Assertions |
|------|------|------------|
| 1 | user_yes via handleConfirmationReply | skipCount=0 + RESPONDED `user_yes` + predicate returns false |
| 2 | user_no via handleConfirmationReply | skipCount=0 + RESPONDED `user_no` + predicate returns false |
| 3 | drop_it via routeRefusal hard_disable | enabled=false + skipCount=0 + RESPONDED `user_drop_it_or_disable` + Haiku NOT called |
| 4 | not_now via routeRefusal not_now | enabled=true + adjustment_mute_until set + skipCount=0 + RESPONDED `user_not_now` + predicate returns false |
| 5 | auto_re_enable via autoReEnableExpiredMutes | enabled=true + skipCount=0 + mute_until=null + RESPONDED `auto_re_enable` + predicate returns false |

Fixture name `'adj-no-refire-integration-test-ritual'` is unique (no collision with the Phase 28 `adj-dialogue-integration-test-ritual` fixture).

Cumulative afterAll: `expect(mockAnthropicCreate).not.toHaveBeenCalled()` — Sonnet/messages.create NEVER called from any of these paths (Pitfall 6 invariant carried from Phase 28).

WARNING-5 fix: each Case filters `ritual_fire_events` by both `ritualId` AND `metadata.source` to isolate the completion event from the prior in_dialogue fire emitted by `fireAdjustmentDialogue`.

## Canonical FR + RU exemplars (for Phase 46 reuse)

| Site | French | Russian |
|------|--------|---------|
| Fire-side prompt | `J'ai remarqué qu'on a sauté le rituel ${name} plusieurs fois. Tu veux ajuster quelque chose, ou on garde comme ça ?` | `Я заметил, что мы пропустили ${name} несколько раз. Хочешь что-то изменить, или оставим как есть?` |
| Hard-disable ack | `D'accord, je désactive ce rituel. Tu peux le réactiver manuellement à tout moment.` | `Хорошо, отключаю этот ритуал. Ты можешь включить его вручную в любое время.` |
| Not-now ack | `D'accord, je passe le dialogue d'ajustement pendant 7 jours. Le suivi des sauts continue.` | `Хорошо, пропускаю диалог настройки на 7 дней. Учёт пропусков продолжается.` |
| Auto-pause msg | `Je mets le ${n} en pause pendant 30 jours — j'ai l'impression que le timing ne va pas. Réactivation auto le ${d}.` | `Ставлю ${n} на паузу на 30 дней — кажется, момент не подходящий. Автоматическое включение ${d}.` |
| Yes-applied ack | `Appliqué : ${f} = ${v}` | `Применено: ${f} = ${v}` |
| No-keeping ack | `D'accord, je garde ${f} tel quel` | `Хорошо, оставляю ${f} как есть` |
| Confirmation echo | `Changer ${f} en ${v} — OK ? (s'applique auto dans 60 s sans réponse)` | `Изменить ${f} на ${v} — OK? (применится автоматически через 60 сек без ответа)` |
| Reject error | `Cette valeur ne semble pas avoir le bon type pour ${f} — je garde la config actuelle.` | `Это значение не похоже на правильный тип для ${f} — оставляю текущую конфигурацию.` |

## ADJUSTMENT_JUDGE_PROMPT field list

`(one of: fire_at, fire_dow, skip_threshold)` — confirmed in sync with post-ADJ-05 enum (no `mute_until`).

## ADJ-06 rejection-path audit-event envelope

```typescript
patch: {
  kind: 'rejected',
  field: proposedChange.field,          // 'fire_at' | 'fire_dow' | 'skip_threshold'
  attempted_new_value: <the offending value>,
  error: <ZodError message>,
  source: actor === 'auto_apply_on_timeout' ? 'sweep' : 'reply',
}
```

Extends the existing discriminated patch envelope (RESEARCH Landmine 1 of Phase 28). Additive; no consumers broken.

## Deviations from plan

### PLAN-CHECK warnings addressed inline

- **WARNING-3** (cron-context reject sendMessage as new surface): suppressed via `if (actor !== 'auto_apply_on_timeout')` guard before the rejection sendMessage. Greg does NOT get out-of-band Telegram notifications when the 60s-deferred patch fails type-check.
- **WARNING-4** (confirmConfigPatch signature vs internal locale): chose internal resolution. `confirmConfigPatch` signature unchanged; locale resolved via `getLastUserLanguageFromDb` inside the function.
- **WARNING-5** (Cases 1+2 ritual_fire_events filter): each Case filters by both `ritualId` AND `metadata.source` to isolate completion events from prior in_dialogue fires.

### Auto-fixed issues
None — Tasks 1+2+3 executed exactly as planned with the WARNING fixes applied inline.

## Per-task commits

| Task | Commit | Files |
|------|--------|-------|
| 1 | `60fcbdd` | `src/rituals/adjustment-dialogue.ts` (enum tighten + REJECT_ERROR_MSG + candidate-parse gate) |
| 2 | `76d0f98` | `src/rituals/adjustment-dialogue.ts` (locale wiring + 7 Record<Lang> maps + Haiku prompt rewrite) |
| 3 | `ff0e59b` | `src/rituals/__tests__/adjustment-dialogue-no-refire.test.ts` (NEW, 5 cases) |

## Self-Check: PASSED

- `src/rituals/__tests__/adjustment-dialogue-no-refire.test.ts` exists.
- Commit `60fcbdd` exists.
- Commit `76d0f98` exists.
- Commit `ff0e59b` exists.

## DEPLOYED

- [ ] Container rebuilt + redeployed to Proxmox (after Plan 41-01 deploys clean)
- [ ] Smoke test FR: set Greg's recent USER message to French, force threshold-hit, observe fire-side prompt renders in French
- [ ] Smoke test: send `{field: 'mute_until', new_value: 'x'}` via mocked Haiku → assert Zod rejects at parse
- [ ] Smoke test: send `{field: 'fire_at', new_value: 42}` → assert candidate-parse rejects, `ritual_config_events.patch.kind='rejected'` row exists
