---
status: partial
phase: 27-daily-wellbeing-snapshot
source: [27-VERIFICATION.md]
started: 2026-04-28T17:30:00Z
updated: 2026-04-28T17:30:00Z
---

## Current Test

[awaiting human testing — requires staging deploy + real Telegram client]

## Tests

### 1. SC-1 — 3-row × 5-button inline keyboard renders + per-dim upsert

**Expected:** Operator runs `npx tsx scripts/fire-wellbeing.ts` against staging. Greg's Telegram receives one message with a 3-row × 5-button keyboard (energy/mood/anxiety, 1-5 each) + skip button as the 4th row. Each tap upserts the corresponding dimension via `INSERT ... ON CONFLICT DO UPDATE SET <dim> = EXCLUDED.<dim>`.

**Test instructions:**
1. Deploy current main to staging (must include 27-03 commit `0aed1c8` or later).
2. SSH to Proxmox: `npx tsx scripts/fire-wellbeing.ts daily_wellbeing` in chris container.
3. Greg opens Telegram, observes message + 3-row keyboard.
4. Tap energy=3, then mood=4, then anxiety=2.
5. Verify in postgres: `SELECT * FROM wellbeing_snapshots WHERE snapshot_date = current_date;` returns one row with energy=3, mood=4, anxiety=2.

**result:** [pending]

---

### 2. SC-2 — Tap-redraw + anchor-bias defeat (Pitfall 13)

**Expected:** Each tap redraws the keyboard with currently-tapped values HIGHLIGHTED (e.g., `[3]` brackets) but PREVIOUS DAYS' values HIDDEN. After all 3 dimensions tapped, message edits to a confirmation summary.

**Test instructions:**
1. Run SC-1 once to seed yesterday's row.
2. Wait ~24h or manipulate clock; fire wellbeing again the next day.
3. On the new day's keyboard, verify NO numbers from yesterday's row appear (anchor-bias defeat).
4. Tap dim values one at a time; observe the keyboard redraw with `[N]` highlights for current taps only.
5. After 3rd dim tap, verify message edits to "✓ Snapshot saved: energy=X mood=Y anxiety=Z".

**result:** [pending]

---

### 3. SC-3 — Skip button distinct from fired_no_response

**Expected:** Tapping "skip" closes the snapshot with `adjustment_eligible: false`, emits `'wellbeing_skipped'` outcome, does NOT increment `rituals.skip_count`, and does NOT trigger Phase 28 adjustment dialogue (Phase 28 not yet shipped — verify by checking `ritual_fire_events` row only).

**Test instructions:**
1. Fire wellbeing on staging.
2. Tap "skip" button immediately (don't tap any dimension).
3. Verify in postgres:
   - `SELECT outcome FROM ritual_fire_events ORDER BY fired_at DESC LIMIT 1;` → `'wellbeing_skipped'`
   - `SELECT skip_count FROM rituals WHERE name = 'daily_wellbeing';` → unchanged from before
   - `SELECT * FROM wellbeing_snapshots WHERE snapshot_date = current_date;` → returns ZERO rows (skip does NOT write to snapshots table)

**result:** [pending]

---

### 4. SC-4 — 09:00 Paris fire honored separately from voice note 21:00

**Expected:** On a real day, both rituals fire — wellbeing at 09:00 Europe/Paris (caught by 10:00 sweep tick) and voice note at 21:00 Europe/Paris (caught by 21:00 ritual sweep tick). Neither blocks the other.

**Test instructions:**
1. Deploy + wait for natural 09:00 Paris fire OR set system clock back/forward.
2. Verify Greg's Telegram receives wellbeing message ~09:00 (10:00 sweep tick may delay up to 60min — D-27-09 documents this latency).
3. Same day, at 21:00 Paris, verify Greg's Telegram receives voice note prompt (Phase 26).
4. Both rituals should land cleanly with separate `ritual_fire_events` rows.

**result:** [pending]

---

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 4 *(all blocked on staging deploy + live Telegram client)*

## Gaps

None at component level — 9/9 programmatic must_haves verified by `bash scripts/test.sh` real-DB harness. The 4 pending items are integration-end items requiring human + Telegram + staging.

## Resolution path

Run `/gsd-verify-work 27` post-deploy to mark items passed/issues. Combine with Phase 26 HUMAN-UAT items if testing in same session.
