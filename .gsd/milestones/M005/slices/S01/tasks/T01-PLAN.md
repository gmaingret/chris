---
estimated_steps: 3
estimated_files: 1
skills_used: []
---

# T01: Update REQUIREMENTS.md with validation evidence for R001–R008, R010–R013

**Slice:** S01 — M001 Requirement Validation (R001–R008, R010–R013)
**Milestone:** M005

## Description

Update `.gsd/REQUIREMENTS.md` for 12 M001-era requirements: change each from `active`/`unmapped` to `validated` with specific evidence. This is a documentation-only task — no code changes needed. The evidence map below provides the exact test names, file paths, and code constructs to cite for each requirement.

## Steps

1. For each requirement R001–R008 and R010–R013 in `.gsd/REQUIREMENTS.md`:
   - Change `Status: active` to `Status: validated`
   - Replace `Validation: unmapped` with the evidence string from the map below
2. Update the traceability table at the bottom of REQUIREMENTS.md: change status column to `validated` and fill the Proof column for all 12 requirements.
3. Update the Coverage Summary section: increment "Validated" count from 3 to 15 (adding 12).

## Evidence Map

Use these exact evidence strings (adapt formatting to fit the file's style):

**R001**: `store.test.ts`: "returns the inserted row with content verbatim (no trimming)" — content with leading/trailing spaces preserved. `store.ts` has no `.trim()` call. 4 store tests pass.

**R002**: `tagger.test.ts`: 7 tests prove Haiku classification into 12-category enum (FACT, EMOTION, BELIEF, INTERPRETATION, IDEA, DECISION + 6 more), fire-and-forget contract (returns null on failure, never throws). `tagger.ts` uses `HAIKU_MODEL`.

**R003**: `retrieve.test.ts`: "returns entries ranked by descending similarity score (R003)". `embeddings.test.ts`: 1024-dim vector output, bge-m3 model with CLS pooling + L2 normalization. `retrieve.ts` uses `cosineDistance` + `orderBy(asc(distance))`.

**R004**: `auth.ts`: `ctx.from?.id === config.telegramAuthorizedUserId` — non-matching messages silently dropped (no `next()`, no response). First middleware in chain (`bot.ts`: `bot.use(auth)`). Code inspection proof — architectural property.

**R005**: `engine.test.ts`: "stores entry via storePensieveEntry", "fires tagEntry and embedAndStore", "calls Sonnet with conversation history". `prompts.ts` JOURNAL_SYSTEM_PROMPT: "NEVER confirm that you've stored, saved, recorded". 30 engine tests pass.

**R006**: `engine.test.ts`: "routes INTERROGATE to handleInterrogate". `prompts.ts` INTERROGATE_SYSTEM_PROMPT: "Answer ONLY from the entries above", "Cite entries by their date". `context-builder.test.ts`: 13 tests prove context formatting with citations.

**R007**: `client.ts`: `HAIKU_MODEL` + `SONNET_MODEL` constants. `tagger.ts` uses Haiku for classification. `engine.ts` detectMode uses Haiku. Journal/interrogate handlers use Sonnet. Code inspection proof.

**R008**: `index.ts`: `config.webhookUrl` → Express webhook with `webhookCallback(bot, 'express')` or `bot.start()` polling fallback. `bot-integration.test.ts`: 6 tests prove message pipeline. Code inspection proof for dual-mode.

**R010**: `retrieve.test.ts`: "passes French query text through to embedText (R010)", "passes Russian query text through to embedText (R010)". `config.ts`: `embeddingModel` defaults to `Xenova/bge-m3` (multilingual, 100+ languages).

**R011**: `prompts.ts` JOURNAL_SYSTEM_PROMPT: "NEVER state things as fact that Greg hasn't told you". INTERROGATE_SYSTEM_PROMPT: "If Memory Entries is empty... say honestly: 'I don't have any memories about that.' Do NOT guess or fabricate." Prompt-enforced architectural constraint.

**R012**: `retrieve.test.ts`: "ranks old but more relevant entries above recent less relevant ones — temporal neutrality (R012)". `retrieve.ts`: `orderBy(asc(distance))` — no temporal factor in ranking query. Pure cosine distance.

**R013**: `engine.test.ts`: "saves both user and assistant messages (R013)". `conversation.test.ts`: 10 tests prove save/load with bigint chatId, message merging. `conversation.ts`: `saveMessage` + `getRecentHistory`.

## Must-Haves

- [ ] All 12 requirements changed from `Status: active` to `Status: validated`
- [ ] All 12 requirements have `Validation:` field with specific test/code evidence (not "unmapped")
- [ ] Traceability table updated for all 12 rows
- [ ] Coverage Summary updated (Validated count = 15)

## Verification

- `grep -c 'Status: validated' .gsd/REQUIREMENTS.md` returns at least 15
- `grep 'Status: active' .gsd/REQUIREMENTS.md | wc -l` returns 9 (21 total active minus 12 newly validated = 9 remaining for S02/S03)
- `npx vitest run` passes cleanly (no code changes, just confirming no regressions)

## Inputs

- `.gsd/REQUIREMENTS.md` — current requirements file with 12 requirements showing `Status: active` and `Validation: unmapped`

## Expected Output

- `.gsd/REQUIREMENTS.md` — updated with 12 requirements showing `Status: validated` with evidence text, updated traceability table and coverage summary
