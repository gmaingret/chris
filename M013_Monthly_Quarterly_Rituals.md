# M013 — Monthly + Quarterly Rituals + Anti-Sycophancy Monitoring

**Slash command:** `/gsd:new-milestone "M013 Monthly Quarterly Rituals Anti-Sycophancy Monitoring"`

## Goal

Build the two heavier ritual protocols that depend on the profile layer (monthly reconciliation and quarterly Butler chapter review) plus the full structural anti-sycophancy monitoring layer. Weekly review already shipped in M009; this milestone handles everything that requires the profile layer to be populated.

## Why these belong together

Monthly reconciliation needs `profile_schwartz` from M011 (to compare stated values against revealed behavior). Quarterly Butler review benefits from episodic summaries, profile transitions, decisions resolved, and mental model applications across the full quarter. The anti-sycophancy behavioral monitoring (agreement-to-challenge ratio, comfort-zone detection, monthly devil's advocate, quarterly recalibration, steelman-then-challenge, Popper belief probe) consumes profile data and ritual data to score drift over time — Layer 2 of the anti-sycophancy architecture.

## Target features

- **Monthly reconciliation ritual** fires the first weekend of the month. 4-step protocol:
  1. Summary — Chris presents a neutral readout of the month (themes, decisions made/deferred, emotional arc, profile changes)
  2. Reconciliation — Chris compares stated values from `profile_schwartz` against revealed behavior from episodic summaries, highlighting gaps and alignments
  3. Response — John responds verbally
  4. Forward note — John states one thing to change, one to protect, one open question

  **Not a performance review** — point is examination, not optimization. No goals, no KPIs.

- **Quarterly Butler chapter review** fires the last weekend of each quarter. 4-step Butler life-review protocol:
  1. What happened? — narrative summary of the quarter
  2. What did you learn? — patterns from the quarter
  3. How do you interpret it now? — meaning-making
  4. What's the next chapter? — title and theme

  Step 4 output stored as a tagged Pensieve entry until M014 migrates it to a `life_chapters` row.

- **Monthly devil's advocate session**, scheduled separately from the monthly reconciliation. Opus runs with a system prompt that forbids hedging and constructs the strongest real counter-case against ONE of John's currently-held positions (capital allocation, jurisdictional plans, in-flight decisions, stated values). One position per session, argued in depth — not five argued shallowly. Borrowed from how good investment committees work: someone's job, by rotation, is to be the no.

- **Quarterly recalibration check-in**, standalone 5-minute ritual separate from the Butler review. Chris asks directly: "Have I been too soft or too harsh this quarter? Mirror or sparring partner?" Response tunes next quarter's anti-sycophancy parameters (preamble strictness, praise quarantine threshold, devil's advocate intensity). Two consecutive "too soft" responses auto-tighten the constitutional preamble; "too harsh" loosens.

- **Anti-sycophancy behavioral monitoring**:
  - Agreement-to-challenge ratio over a rolling 30-day window using Haiku per-response classification. Flags itself when agreement exceeds 70% and surfaces the vital sign in the weekly review.
  - Comfort-zone detection: tracks topics John raises vs avoids. If a topic John used to engage with has gone silent 30+ days, Chris names it ("we haven't talked about X in six weeks, last time you were uncertain — want to revisit?"), at most once per topic per month.

- **Steelman-then-challenge protocol** in PRODUCE and COACH modes. When John proposes a position (detected by Haiku), Chris first restates the strongest version, then articulates the strongest counter-argument, then asks which one **survives** — using the word "survives" specifically, not "what do you think". Phrasing forces a verdict instead of inviting more elaboration. Fires only on position statements, not journal entries, questions, or emotional content.

- **"What would change your mind" probe** for strong belief statements. When John states a strong belief (confidence markers "I'm sure", "obviously", "clearly", "definitely" + EN/FR/RU equivalents) outside a decision-capture context, Chris periodically asks what evidence would falsify it. If John can't answer, the belief is stored as "untested" rather than "examined" in relational memory and surfaces in the next monthly reconciliation. Fires at most once per conversation and at most weekly per topic.

- **Synthetic fixture test**:
  1. One synthetic month with embedded values-behavior mismatches → run monthly reconciliation → verify at least one specific value-vs-behavior comparison surfaced with evidence
  2. One synthetic quarter of three months with profile transitions and decisions → run quarterly chapter review → verify all 4 Butler steps complete and output persists
  3. Scripted position statements trigger steelman-then-challenge in PRODUCE
  4. Seeded strong belief statements trigger the "what would change your mind" probe
  5. 30 days of mock conversation with >70% agreement triggers the anti-sycophancy vital sign
  6. Simulated devil's advocate session produces a non-hedging counter-case
  7. Simulated recalibration response correctly adjusts the preamble strictness parameter

## Acceptance

All 7 synthetic fixture sub-tests pass. After several months of real use, a real monthly reconciliation surfaces at least one genuine values-behavior gap, the agreement-to-challenge ratio is being tracked and visible in the weekly review, and the quarterly recalibration response actually changes next quarter's preamble.
