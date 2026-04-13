# M007 — Decision Archive

**Slash command:** `/gsd:new-milestone "M007 Decision Archive"`

## Goal

Build the keystone feature of the soul system — capture every structural decision John makes with its reasoning and a falsifiable forecast, then surface the forecast at its resolution date and prompt a post-mortem. Convert Chris from a reflective journal into an epistemic accountability tool.

## Why this matters

The decision archive is the only layer of the soul system that can genuinely *challenge* John rather than describe him. Personality profiles are slow-moving and hard to validate. A decision with a captured prediction and a deadline is different — every captured decision generates a future moment where reality answers. Over time this builds an empirical record of where John's reasoning is sharp and where it is systematically off. Scoreboard, not mirror. Per the PRD: *"if you only get one layer right, make it the decision archive."*

## Target features

- **New `decisions` table** in the Drizzle schema: id, captured_at, decision (text), alternatives (jsonb array), reasoning (text), prediction (text), falsification_criterion (text), resolve_by (timestamp), status (enum: open/due/resolved/reviewed), resolution (text nullable), resolution_notes (text nullable), reviewed_at (timestamp nullable).
- **Decision detection in the engine**: trigger phrases "I'm thinking about", "I need to decide", "I'm weighing", "I'm not sure whether" + French ("je réfléchis à", "je dois décider", "j'hésite") + Russian equivalents activate the capture protocol.
- **5-question capture protocol** implemented as a guided sub-conversation:
  1. The decision in one sentence
  2. The alternatives including rejected ones
  3. The reasoning
  4. A falsifiable prediction with timeframe
  5. The Popper question — what would tell John he was wrong
- **Decision lifecycle state machine** enforced at the database/code layer: `open` → `due` (resolve_by passed) → `resolved` (John stated what happened) → `reviewed` (post-mortem complete). No implicit transitions.
- **Forecast deadline scheduler** integrated into the existing proactive sweep: when a decision's `resolve_by` passes, transition to `due` and surface a resolution prompt within 24 hours: "On {date} you predicted {prediction}. What actually happened?"
- **Resolution flow**: when John responds to a resolution prompt, capture and store in `resolution_notes`, transition to `resolved`, then ask one follow-up ("what would you do differently?" or "what surprised you?") and transition to `reviewed`. Both responses become Pensieve entries.
- **`/decisions` Telegram command**: lists open decisions, recently resolved, and forecast accuracy stats over rolling 30/90/365-day windows. Accuracy computed by Haiku classification of prediction vs resolution text.
- **Synthetic fixture test**: generate captured decisions with `resolve_by` deadlines simulated in the past via mock clock, run the proactive sweep, verify resolution prompts surface and lifecycle transitions happen in the enforced order. No real calendar time required.

## Acceptance

John can talk through a real decision in Telegram and have it captured correctly with all 5 elements. A decision with a 7-day forecast (set via mock clock in the test) gets surfaced exactly 7 days later. The resolution conversation produces a stored post-mortem and the lifecycle reaches `reviewed`. The `/decisions` command returns accurate stats.

## Pause before M008

At least 2 weeks of real Telegram usage. M007 is the highest-leverage feature in the whole system; validate the trigger phrases and the capture flow against John's actual decision-making rhythm before moving on.
