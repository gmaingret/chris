# M006 — Trustworthy Chris ⚠️ URGENT

**Slash command:** `/gsd:new-milestone "M006 Trustworthy Chris"`

## Goal

Fix the four trust-breaking conversational failures observed in real Telegram testing on April 11, 2026, and harden Chris with a four-layer constitutional anti-sycophancy preamble plus structured fact retrieval — before any soul-system work is layered on top.

## Why first

Real-conversation testing during M005 surfaced specific failures that would amplify catastrophically once profiles, rituals, and decision capture are added. Chris currently (a) ignores explicit refusals and re-asks the same question, (b) confabulates wrong facts about John from prose-dumped memory context (e.g., "Cagnes-sur-Mer" instead of "Golfe-Juan", wrong direction of move), (c) apologizes performatively without changing behavior, (d) follows an interview-question pattern. Layering eight profiles, ritual scheduling, and decision capture on top of these failures would amplify all of them.

## Target features

- **Refusal handling rule** in all 6 system prompts. When John says "I don't want to talk about that" (+ EN/FR/RU equivalents), Chris acknowledges once and never returns to the declined topic in the same conversation, even after intervening turns.
- **Per-session "declined topics" state** injected into subsequent system prompts so the topic stays declined across intervening turns.
- **JOURNAL mode upgraded to hybrid retrieval** — pulls FACT/RELATIONSHIP/PREFERENCE/VALUE-tagged Pensieve entries before each Sonnet call. Currently only Reflect/Coach/Psychology/Produce use it.
- **Language detection moved out of prompt rules into engine pre-processing** via `franc`. The current message's language is passed as a hard system parameter, overriding statistical bias from the prior 20-message history.
- **Question-pressure reduced** in `JOURNAL_SYSTEM_PROMPT` — questions become optional rather than expected. Chris is allowed to simply respond.
- **Constitutional anti-sycophancy preamble** added as a shared prefix in `src/chris/personality.ts` `buildSystemPrompt()` and applied to all 6 modes. Single source of truth: "Your job is to be useful to John, not pleasant. Agreement is something you arrive at after examination, not your starting point. He will tell you when he wants emotional support; assume the rest of the time he wants honest pressure."
- **The Hard Rule** encoded as a forbidden-pattern constraint inside the preamble: Chris is never allowed to tell John he is right because of who he is — no appeals to past track record as evidence for current claims.
- **Three absolute forbidden behaviors** as hard preamble constraints: (1) never resolve contradictions on its own, (2) never extrapolate to novel situations, (3) never optimize responses for emotional satisfaction.
- **Praise quarantine** — lightweight Haiku post-processing pass that strips reflexive flattery from JOURNAL/REFLECT/PRODUCE responses before they're sent. COACH/PSYCHOLOGY already forbid flattery at prompt level and bypass the post-processor.
- **Structured fact injection** in `src/pensieve/retrieve.ts`. Stable facts (location, residency, next move, dates, origin, primary relationships) extracted from FACT/RELATIONSHIP-tagged entries and injected into system prompts as a "Known Facts About John" key-value block, separate from the narrative context block.
- **Live integration test suite**: 24 cases against real Sonnet, each run 3 times with 3-of-3 passes. Categories:
  1. Refusal handling — 3 EN/FR/RU
  2. Topic-decline persistence across 5+ intervening turns — 3
  3. JOURNAL grounding with seeded facts verified via Haiku follow-up — 3
  4. Language switching EN↔FR/RU verified via `franc` on response — 3
  5. Sycophancy resistance to weak arguments — 3
  6. **Hallucination resistance** — 3 cases asking about facts NOT in the Pensieve, verifying Chris says "I don't have any memories about that" instead of confabulating
  7. **Structured fact retrieval accuracy** — 3 cases with seeded location/residency/dates, verifying Chris reports them verbatim without scrambling direction of movement
  8. **Performative apology detection** — 3 cases verifying Chris produces actually-different behavior after being called out, rather than rephrasing the same question
- **Contradiction detection false-positive audit** — synthetic test seeding 20 adversarial non-contradictory pairs (same topic with evolving circumstances, different aspects of same concept, time-bounded statements over different periods, conditional statements with different conditions, emotional vs factual statements), verifying the M002 detector surfaces 0 false positives.

## Memory audit (do this first)

Before changing any code, dump everything Chris currently "knows" about John from the live Pensieve and reconcile against ground truth. Repair or annotate any incorrect or outdated entries.

**Ground truth:** French national, born June 15 1979 in Cagnes-sur-Mer. In Saint Petersburg, Russia until 2026-04-28. Then 1 month in Batumi, Georgia. Then Antibes, France June through end of August 2026. Then permanent relocation to Batumi. Owns rental property in Golfe-Juan (tenanted via Citya since October 2022). Operates MAINGRET LLC (New Mexico) + Georgian Individual Entrepreneur. Holds Panama permanent residency. FI target: $1.5M.

## Acceptance

All 24 live integration test cases pass 3-of-3 against real Sonnet. Memory audit complete. John can have a normal conversation with Chris on Telegram without it inventing facts, ignoring refusals, mismatching language, or apologizing performatively. Manual smoke test on John's actual phone passes.

## Pause before M007

At least 1 week of real Telegram usage before starting M007. Real usage tells you what real testing missed.