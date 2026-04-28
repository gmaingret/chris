---
status: partial
phase: 26-daily-voice-note-ritual
source: [26-VERIFICATION.md]
started: 2026-04-28T09:30:00Z
updated: 2026-04-28T09:30:00Z
---

## Current Test

[awaiting human testing — requires staging deploy with live Telegram bot token]

## Tests

### 1. SC-1 Operator UAT — daily_voice_note ritual end-to-end

**Expected behavior:** Operator runs `npx tsx scripts/fire-ritual.ts daily_voice_note` against staging (deployed Phase 26). Greg's Telegram receives one of 6 spec prompts. Greg replies via Telegram (text via Android STT keyboard, NOT voice message). Reply lands in `pensieve_entries` with `epistemic_tag = 'RITUAL_RESPONSE'` AND `metadata.source_subtype = 'ritual_voice_note'`. **Critically: Chris generates ZERO chat response** (engine returns empty string, IN-02 silent-skip).

**Why this can't be programmatically tested from sandbox:** Requires live Telegram bot token + Telegram client (Greg's phone). Component-level evidence (PP#5 detector + atomic consume + Pensieve write + cumulative `not.toHaveBeenCalled()` regression test) all green in `engine-pp5.test.ts` — but the end-to-end Telegram round-trip is the user-facing contract.

**Test instructions:**
1. Deploy current main to staging Proxmox container.
2. Verify deploy commit ≥ ef67ee4 + Phase 26 final commit (`git log` on container should show 26-05 metadata commit).
3. SSH to Proxmox: `npx tsx scripts/fire-ritual.ts daily_voice_note` (in chris container working dir).
4. Within 18h, reply via Telegram with any text message.
5. Verify in postgres: `SELECT epistemic_tag, metadata FROM pensieve_entries ORDER BY created_at DESC LIMIT 1;`
   - Expected: `epistemic_tag = 'RITUAL_RESPONSE'`, `metadata.source_subtype = 'ritual_voice_note'`
6. Verify Chris produced NO chat response (no message arrived from bot to Greg's Telegram after his reply).

**result:** [pending]

---

### 2. SC-4 Operator UAT — voice message polite-decline

**Expected behavior:** Greg sends an actual Telegram voice message (NOT text via STT keyboard) to the bot. Bot replies with a polite decline in EN/FR/RU based on Greg's last text message language (per `franc` detection). The decline suggests the Android STT keyboard mic icon. Voice message is NOT silently dropped.

**Why this can't be programmatically tested from sandbox:** Requires live Telegram bot + Greg recording + sending an actual voice message via Telegram client. Component-level evidence (`voice-decline.ts` handler + `bot.on('message:voice')` registration in `bot.ts:85` + 7/7 unit tests for EN/FR/RU templates) all green — but the actual Telegram voice delivery + polite-decline reply round-trip is the user-facing contract.

**Test instructions:**
1. Deploy current main to staging Proxmox container.
2. From Greg's Telegram client, ensure last text message to Chris was in a known language (e.g., English: "test"; French: "test"; Russian: "тест").
3. Switch to Telegram voice message mode (hold the mic icon in Telegram, not the Android STT keyboard mic). Record any short voice clip.
4. Send the voice message.
5. Verify within seconds: Chris replies with a polite decline matching the language of step 2.
   - English: "I can't transcribe voice messages — could you tap the microphone icon on your keyboard instead and dictate the text?"
   - French: equivalent in French (verify with Greg's preferred phrasing)
   - Russian: equivalent in Russian
6. Verify the voice message itself is NOT processed through the engine pipeline (no Pensieve write, no LLM call).
7. Repeat for the other two languages by sending a text message in each language first, then sending a voice message.

**result:** [pending]

---

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 2 *(both blocked on staging deploy + live Telegram bot — not testable from sandbox)*

## Gaps

None at component level — all 17 plan-level truths verified by automated tests. The 2 pending items are integration-end items that require human + live Telegram + staging deploy.

## Resolution path

When ready to verify post-deploy:
- Run `/gsd-verify-work 26` to start UAT loop
- Mark each item passed/issues
- If all pass: VERIFICATION.md status flips from `human_needed` to `passed`; phase shipped 100%
- If issues: gap closure via `/gsd-plan-phase 26 --gaps`
