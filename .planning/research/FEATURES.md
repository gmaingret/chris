# Feature Research — M009 Ritual Infrastructure + Daily Note + Weekly Review

**Domain:** Scheduled-ritual infrastructure for a personal AI journal (single user, Telegram bot, append-only Pensieve substrate)
**Researched:** 2026-04-26
**Confidence:** HIGH on retention/abandonment (deposit-only, prompt structure, scale granularity, skip threshold) — multiple independent sources converge; MEDIUM on ritual scheduling architecture (industry patterns are general, the concrete `rituals.config` JSONB shape is opinion-driven); LOW on specific time-of-day defaults (no controlled trial data, only practitioner consensus).

---

## Reading guide

This research file answers six categories of M009 questions, each ending in a `Verdict` block tagged TABLE STAKES / DIFFERENTIATOR / ANTI-FEATURE so the requirements step can map to REQ-IDs and Out-of-Scope entries.

The five categories the requirements step will use:
1. **Daily Voice Note** ritual (deposit-only, 6 rotating prompts)
2. **Daily Wellbeing Snapshot** (1–5 inline keyboard taps for energy/mood/anxiety)
3. **Weekly Review** (one observation + one Socratic question)
4. **Skip-Tracking & Adjustment Dialogue** (3 consecutive skips → reconfigure)
5. **Ritual Infrastructure** (`rituals` table, scheduler, cadence machinery)

A sixth section at the end consolidates **MVP Definition**, **Dependencies**, and the **Prioritization Matrix** in the project-template format.

---

## 1 — Daily Voice Note (deposit-only)

### 1.1 Why "Chris does NOT respond" is correct (TABLE STAKES)

**The spec's "deposit-only" rule is the single highest-leverage retention decision in M009.** Three converging evidence streams support it:

- **Empirical abandonment data.** A 2024 scoping review found a median 70 % of users abandon mental-health / lifestyle apps within 100 days, with steepest dropoff in the first 14 days ([mylifenote.ai abandonment review summary](https://blog.mylifenote.ai/abandonment-journal-prompts/), [lumejournalapp.com](https://lumejournalapp.com/why-cant-i-stick-to-journaling/)). The dominant attrition driver is **"willpower as battery"** — every additional cognitive demand at deposit time drains the battery and accelerates churn ([affirmationsflow.com](https://www.affirmationsflow.com/blog/why-you-quit-journaling-after-3-days-and-the-stack-and-scale-fix)).
- **The blank-page failure mode.** Apps that hand the user an empty canvas after a prompt — including a chat reply that demands engagement — recreate the blank-page problem the prompt was designed to solve ([thatjournalingguy.substack.com](https://thatjournalingguy.substack.com/p/why-most-people-fail-at-journaling), [practicalpkm.com](https://practicalpkm.com/eliminate-the-journaling-friction-with-daily-questions/)). Five Minute Journal's enduring popularity (Tim Ferriss, Intelligent Change) is built explicitly on **closed-end prompts that bookend the day with no AI follow-up** ([Tim Ferriss on X](https://x.com/tferriss/status/1937337697313472550), [intelligentchange.com](https://www.intelligentchange.com/blogs/read/the-five-minute-journal-questions)).
- **Stoic-app product decision.** Apple Editors' Choice Stoic (4.8 ★, [getstoic.com](https://www.getstoic.com/)) ships its evening reflection as deposit-only structured prompts; AI commentary is a *separate* opt-in mode, not interleaved with the ritual itself.

The mechanism: a Chris response converts a 30-second voice deposit into a multi-turn conversation, which becomes a chore, which gets skipped. Deposit + auto-store + silence preserves the frictionlessness that makes the habit survivable on bad days. **This rule is the single non-negotiable behavior of the ritual.**

**Verdict:** TABLE STAKES — Chris MUST NOT generate a chat response to the daily voice note. The voice transcript is stored as a Pensieve entry, tagged via the existing M001 fire-and-forget tagger, and that's it. Chris remains available for normal `JOURNAL`-mode conversation if Greg starts one *after* depositing — but the ritual itself ends at storage.

**Anti-feature variant:** an AI "follow-up question" at the end of the voice note ("Tell me more about X?"). Surface appeal: deeper data. Actual cost: kills the habit. Already-present existing JOURNAL-mode follow-up logic must be **bypassed** when the deposit is in response to a ritual prompt — this needs a runtime flag on the Pensieve entry or on the engine call path.

---

### 1.2 Prompt rotation strategy beyond "no consecutive duplicates" (DIFFERENTIATOR)

The spec mandates "no consecutive duplicates." That floor is correct but underspecified. Four candidate strategies, evaluated:

| Strategy | Pro | Con | Verdict |
|---|---|---|---|
| Random with no-repeat-of-last | Simple, unpredictable enough to feel fresh | Can feel arbitrary; 2-out-of-6 chance of seeing same prompt within 3 days | OK floor (spec) |
| Round-robin (deterministic 1→2→3→4→5→6→1) | Guarantees full coverage in 6 days | Predictable; Greg learns the cycle and pre-loads answers (poisons the data) | REJECT |
| **Random-with-cooldown (no repeat within last 3)** | Coverage + variety; no prompt seen twice in any 4-day window | Slightly more state | **RECOMMENDED** |
| Weighted by Greg's recent answers (Haiku-classified) | Adaptive — surface prompts under-engaged | Adds Haiku call to scheduler; risks feeling steered; opaque | Defer to M013+ |

**Evidence:** [journalinginsights.com](https://journalinginsights.com/how-to-use-a-journaling-prompts-generator-for-daily-reflection/) explicitly documents prompt fatigue from over-rotation of small pools, and recommends "rotate sources, vary angles" as the abandonment-prevention strategy. Reflect.app and Stoic both rotate within ~10–20 prompts to keep variety high; a 6-prompt pool needs the strongest cooldown rule it can support.

**Verdict:** TABLE STAKES — "no consecutive duplicates" floor (REQ from spec, keep). DIFFERENTIATOR — extend to "no repeat in last 3 prompts" cooldown. State stored as `rituals.config.prompt_history: [int, int, int]` for the daily voice note ritual row. Implementation: 5 lines in the rotation function. ANTI-FEATURE — Haiku-weighted adaptive prompting (defer to M013; risks the "steering" trap and adds an LLM call to the scheduler).

---

### 1.3 Are the 6 prompts in the spec good prompts? (TABLE STAKES — confirmed with one re-ordering)

The spec's prompts:
1. "What mattered today?"
2. "What's still on your mind?"
3. "What did today change?"
4. "What surprised you today?"
5. "What did you decide today, even if it was small?"
6. "What did you avoid today?"

**Mapping to reflection-research dimensions** (drawn from [positivepsychology.com journaling prompts](https://positivepsychology.com/journaling-prompts/), [reflection.app/blog/journaling-techniques](https://www.reflection.app/blog/journaling-techniques), [rosebud.app gratitude prompts](https://www.rosebud.app/blog/gratitude-journal-prompts), Stoic's licensed-therapist-curated 6-prompt set [getstoic.com/blog/6-journaling-prompts](https://www.getstoic.com/blog/6-journaling-prompts-to-cultivate-the-quiet-discipline-of-reflection)):

| Spec prompt | Reflection dimension | Surfaced in research lit | Verdict |
|---|---|---|---|
| 1. "What mattered today?" | Salience / signal-vs-noise | Stoic, Reflection.app | KEEP |
| 2. "What's still on your mind?" | Open loops / unresolved threads | Five Minute Journal evening, GTD weekly review | KEEP |
| 3. "What did today change?" | Update detection / belief revision | Less common — *implicit Bayesian framing*, this one is the most "Chris-flavored" | KEEP — differentiator |
| 4. "What surprised you today?" | Novelty / prediction error | Daniel Kahneman's "surprise journal", Stoic, Reflection.app | KEEP — high-value |
| 5. "What did you decide today, even if it was small?" | Decision capture (ties to M007) | Decision-archive literature; explicit in keystone PRD | KEEP — explicitly bridges to M007 keystone |
| 6. "What did you avoid today?" | Shadow / avoidance behavior | Depth-psychology lit (Jungian shadow work); rare in commercial apps | KEEP — the highest-signal prompt for psychology layer (M011); also the riskiest |

**Coverage analysis.** The six prompts cover six distinct reflection dimensions with minimal overlap. Notably absent: explicit gratitude prompt. Five Minute Journal, Stoic, Reflection.app all open with gratitude. Should we add one?

**Recommendation: do NOT add gratitude as a 7th prompt, do NOT replace one.** The PRD anti-flattery design and D027 "The Hard Rule" make Chris constitutionally allergic to the comfort-optimizing trap. Gratitude prompts have well-documented benefits ([positivepsychology.com — Seligman 25 % happiness lift](https://positivepsychology.com/journaling-prompts/)) but they over-fit the well-being-app niche Chris is explicitly NOT trying to occupy. The PRD says: *"He is not a tool, not a chatbot, not a journaling app. He is John's second self and omniscient advisor."* Skipping gratitude is on-brand.

**Single suggested re-ordering for consideration (not required):** rotate the prompt pool such that the *avoidance* prompt (6) does not appear in the first week of any new user's experience. Avoidance prompts on day 1 risk feeling intrusive before trust is established. Implementation: `rituals.config.first_week_blacklist: [6]`. **Defer to operator-tuning post-launch — don't ship with this complication.**

**Verdict:** TABLE STAKES — ship the 6 prompts as specified, in the spec's order. They map cleanly to six reflection dimensions and are coherent with Chris's anti-sycophancy constitution.

---

### 1.4 Time-of-day for daily voice note (TABLE STAKES with config knob)

The spec says "end of John's day" without pinning a clock time. Three approaches:

- **Fixed default 21:00 local** (configurable via `rituals.config.fire_at`). Pro: predictable; honors implementation-intention research (anchor to nightly routine; [dayoneapp.com](https://dayoneapp.com/blog/journaling-habit/), [Gretchen Rubin](https://gretchenrubin.com/articles/jump-start-your-habit-of-keeping-a-journal/)). Con: 21:00 is wrong for night-owls and shift workers.
- **Dynamic from last-message-time heuristic** (fire 30 min after Greg's last Telegram message of the day). Pro: adapts. Con: complex; non-deterministic; brittle on quiet days.
- **Configurable, default Greg-tuned** (default 21:00, config knob from day one).

**Evidence on evening timing.** The strongest empirical anchor is [Journal of Experimental Psychology 2018 sleep study](https://blog.mylifenote.ai/night-journal-prompts/) — bedtime journaling reduced sleep latency by 9 minutes — implying late-evening is psychologically aligned with the deposit-and-let-go function. [Reflect.app](https://www.reflection.app/blog/daily-journal-prompts-365-questions) and Stoic both default to evening. Five Minute Journal explicitly bookends the day.

**Verdict:** TABLE STAKES — default fire time = **21:00 local** (Europe/Paris for Greg per existing timezone-aware sweep cap). Configurable via `rituals.config.fire_at: "HH:MM"` from day one. ANTI-FEATURE — last-message-time heuristic (D041-flavor brittleness; defer indefinitely).

---

### 1.5 Voice → Pensieve pipeline (TABLE STAKES, leverages existing infra)

Voice messages from Telegram already work in production (M003 handles file uploads). The spec assumes Greg uses **Android keyboard speech-to-text** (per "Deferred: Voice message transcription via Whisper" in PLAN.md) — Greg dictates into Telegram's text input, the keyboard transcribes, Greg reviews and sends. The Pensieve entry is text. This sidesteps the Whisper-error-pollution risk per the existing deferred-features section.

**Verdict:** TABLE STAKES — voice = Android-keyboard-dictated text, ingested via the existing Telegram message handler. No new transcription pipeline. The Pensieve entry inherits standard M001 epistemic auto-tagging + M008 episodic consolidation at 23:00. ANTI-FEATURE — server-side Whisper transcription (PLAN.md already defers this).

---

## 2 — Daily Wellbeing Snapshot

### 2.1 Is 1–5 the right scale granularity? (TABLE STAKES — confirmed against research)

**Empirical context from EMA literature** ([Frontiers in Psychology 2021 EMA systematic review](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.642044/full), [Springer 2025 Likert vs VAS in EMA](https://link.springer.com/article/10.3758/s13428-025-02706-2), [PROMIS scoring manual](https://www.healthmeasures.net/images/PROMIS/manuals/Scoring_Manuals_/PROMIS_Anxiety_Scoring_Manual.pdf)):

| Scale | EMA usage frequency | Notes |
|---|---|---|
| 0–100 sliding | Most common in EMA studies | Higher resolution, but slider UX is awkward on Telegram inline keyboard |
| 0–10 | Common in daily mood apps (Daylio, MoodPanda) | 11 buttons; ergonomic limit on inline keyboard |
| **1–7 Likert** | ~9.9 % of sliding-scale items in EMA | Slightly more resolution than 1–5 |
| **1–5 Likert** | ~1.3 % of sliding-scale items but **dominant in PROMIS short forms** ([PROMIS anxiety](https://www.healthmeasures.net/images/PROMIS/manuals/PROMIS_Anxiety_Scoring_Manual.pdf)) | The clinical-validation gold standard |
| Binary (good/bad) | Rare | Loses signal |

**The deciding factor for Chris is NOT psychometric precision — it's tap fatigue.** The spec's UX is 3 dimensions × 5 buttons in a Telegram inline keyboard = 3 taps total per day. Going to 1–7 = 21 buttons → button-grid clutter; going to 0–10 = 33 buttons → unusable on mobile. The PROMIS 5-point scale ([PROMIS short forms](https://www.healthmeasures.net/images/PROMIS/manuals/PROMIS_Anxiety_Scoring_Manual.pdf)) achieves Cronbach α = 0.95–0.96 internal consistency — it is clinically validated, NOT a compromise. Daylio's 5-point design ([daylio.net/how-to-track-moods](https://daylio.net/how-to-track-moods/), [daylio Wikipedia](https://en.wikipedia.org/wiki/Daylio)) is explicitly motivated by "represents nearly all emotions, captures data even when users are at their worst" — i.e. low-effort capture beats high-resolution capture for retention.

**Verdict:** TABLE STAKES — 1–5 scale is correct. Confirmed against PROMIS clinical-validation precedent and Daylio retention rationale. **Spec confirmed; do not change.**

---

### 2.2 Telegram inline keyboard UX — 3 rows × 5 buttons (TABLE STAKES, with explicit guard)

**The proposed UX** (from spec): three messages with 5-button rows, one per dimension (energy / mood / anxiety). Total: 3 message edits, 3 taps.

**Risks identified:**
- **Straight-lining** (all 3s every day) — the classic satisficing pattern from [survey-fatigue research](https://blog.logrocket.com/ux-design/what-is-survey-fatigue-how-can-you-avoid-it/), [LogRocket](https://blog.logrocket.com/ux-design/what-is-survey-fatigue-how-can-you-avoid-it/). Mitigation: at week 4+, if straight-line variance < 0.5, surface "you've been a flat 3 for two weeks — is the question wrong?" (defer to M013 anti-sycophancy monitoring; M009 just records).
- **Three-message UX clutter** — three sequential keyboards over three messages is heavier than one combined message with three rows. Telegram supports multi-row inline keyboards in a single message. Single message ≥ 3-message UX every time.
- **Tap target precision** — Telegram inline keyboard buttons render adequately on mobile; this is a non-issue.

**Recommendation: combine all 3 dimensions into ONE message with 3 keyboard rows.** Single tap-bound experience. Reply path: "energy?" "mood?" "anxiety?" handled via callback_data parsing. Reduces visual chrome and matches How We Feel's compact emotion-grid pattern ([howwefeel.org](https://howwefeel.org/), [Yale](https://medicine.yale.edu/news-article/the-how-we-feel-app-helping-emotions-work-for-us-not-against-us/)).

**Should it fire combined with the voice note or separately?** D026 already locked this answer: **separate**. The spec language "alongside" is delivery-time, not ritual-time. The decision rationale (D026): *"Combining them would either bloat the voice note ritual with structured questions or pollute the numeric series with interpretation."* Concretely: voice note is 21:00 prompt → 30-second voice deposit → done; wellbeing snapshot is delivered immediately after as a *separate* Telegram message with the inline keyboard. Greg can answer one, both, or neither. Skipping the snapshot does NOT trigger the skip-tracking adjustment dialogue (per spec).

**Verdict:** TABLE STAKES — single-message 3-row inline keyboard, fired immediately after the voice note prompt; D026 separation honored. ANTI-FEATURE — sliders or composite single-score (defer slider until M013 if data suggests; composite score loses dimensionality).

---

### 2.3 What does the wellbeing data become useful FOR? (TABLE STAKES — flag the consumer chain explicitly)

The spec is clear that the snapshot is substrate, not display, but the downstream chain matters for storage decisions.

**Confirmed consumers:**
- **M008 episodic summary** — wellbeing scores can be referenced as numeric anchors in the daily summary's `emotional_arc` field. *Not a hard dependency* — M008 already ships and works without snapshots; if M009 adds them, M008's prompt can be extended (Phase 21-style decimal phase if needed) to read them in.
- **M009 weekly review observation generator** — the rolling 7-day mean / variance / trajectory for each dimension is a candidate observation source ("anxiety has been climbing since Wednesday"). **DIFFERENTIATOR for M009 weekly review prompt design.**
- **M010 operational profiles** (jurisdictional / capital / health / family) — health profile in particular reads wellbeing trajectory for clinical context.
- **M011 psychological profiles** — HEXACO Emotionality dimension correlates with anxiety baseline.
- **M013 monthly reconciliation** — values-vs-behavior comparison can include "you said you wanted to prioritize calm; your anxiety mean was 3.6 this month, up from 2.9".

**Successful comparable systems for this loop:**
- [How We Feel](https://howwefeel.org/) (Marc Brackett / Yale Center for Emotional Intelligence) — captures dimensional emotions, surfaces patterns at week-end.
- [Daylio](https://daylio.net/) — explicit habit-mood correlation surfacing.
- mPath / Healthy Minds Program EMA research — uses wellbeing series for delayed insight, not real-time response.

**Verdict:** TABLE STAKES — store the 1–5 triple in `wellbeing_snapshots` table as specified. DIFFERENTIATOR — weekly review observation generator must be wired to read 7-day wellbeing trajectory as ONE candidate observation source (the others being M008 summaries and M007 resolved decisions). ANTI-FEATURE — do NOT show Chris's interpretation back to Greg at deposit time. The data's value is **delayed and cumulative**, not real-time.

---

## 3 — Weekly Review

### 3.1 What does an "observation" actually look like? (TABLE STAKES, with concrete shape)

**The spec mandates exactly one observation + exactly one Socratic question** with runtime token-count enforcement (rejected and regenerated if multi-question). This is the highest-stakes prompt-engineering decision in M009 because the observation defines what makes Chris's weekly review distinct from Sunsama's "wins/challenges/plans" template ([craft.do weekly review](https://www.craft.do/app-templates/weekly-review)) or Notion's open-canvas.

**Comparable systems' weekly digest formats:**

| System | Format | Verdict for Chris |
|---|---|---|
| [Roam Research weekly review](https://gist.github.com/jborichevskiy/51508eebc810ae8105be45beac4e16ac) | Daily-page rollup with tag aggregation; user-driven synthesis | Too unstructured; assumes user does the thinking |
| [Reflect.app](https://otio.ai/blog/reflect-app-review) GPT-4 weekly digest | "Distill key takeaways" — summary-paragraph format | Closest pattern for our `observation` field |
| Sunsama / Notion / ClickUp templates | Wins / challenges / plans (3 buckets) | Performance-review framing; PRD explicitly rejects this for monthly ritual ("Not a performance review") |
| GTD weekly review | Inbox / projects / waiting-for / someday-maybe | Workflow tool, not reflection |

**The right shape for Chris's observation, derived from existing decisions:**

> *"Concrete pattern statement, ≤2 sentences, sourced from at least 2 episodic summaries OR 1 resolved M007 decision, citing dates. Surfaces a tension, evolution, or recurrence — not a summary or a celebration."*

**Examples (synthetic, illustrative):**
- *"You wrote three times this week (Mon, Wed, Fri) about Cagnes-sur-Mer being temporary. On Tuesday you also reaffirmed the Georgia move timeline. Both are in your Pensieve as live; neither is resolved."* → Socratic Q: *"Which of those, if you had to commit today, would you bet on?"*
- *"You forecast on Apr 19 that the contract negotiation would settle by Apr 25; it didn't. You wrote about the same negotiation Tuesday and Thursday, both times with growing frustration."* → Socratic Q: *"What would the version of you on Apr 19 have told the version of you on Apr 24?"*

**Source-data fingerprint (which existing data structures the observation prompt reads):**
- M008 `episodic_summaries` for the 7-day window — `topics[]`, `emotional_arc`, `key_quotes`, `importance` (use `getEpisodicSummariesRange` substrate already shipped per PLAN.md tech-debt notes)
- M007 `decisions` projection — resolved-this-week + those whose `resolve_by` was due this week
- M009 `wellbeing_snapshots` for the 7-day window — mean / variance / trajectory per dimension (DIFFERENTIATOR — see §2.3)
- D031 / D035 boundary: the observation is INTERPRETATION, not Pensieve fact. The header in the user-facing message must mark this — e.g. "Observation (interpretation, not fact):" in the same convention as INTERROGATE's `## Recent Episode Context (interpretation, not fact)` header.

**Verdict:** TABLE STAKES — exactly one observation per the spec; ≤ 2 sentences; sourced from at least 2 episodic summaries OR 1 resolved decision; cites specific dates; honors D031 boundary marker. DIFFERENTIATOR — wellbeing trajectory as a third source dimension (when present and when variance ≥ threshold).

---

### 3.2 What should the Socratic question be ABOUT? (TABLE STAKES, structured taxonomy)

**Three candidate styles, evaluated:**

| Style | Example | When to use | Verdict |
|---|---|---|---|
| **Open Socratic on the observation** ("which one survives?") | "If you had to pick one, which?" | When observation surfaces a tension between two positions | DEFAULT |
| **Forecast-style** ("what does this suggest about next week?") | "What does Tuesday's anxiety spike predict for Thursday's meeting?" | When observation contains a trajectory | When applicable |
| **Decision-archive-style** ("you decided X — how confident are you now?") | "Apr 19's forecast was wrong. What does that update?" | When observation references an M007 resolved decision | When applicable |

**Phrasing convention from M013** (already locked for steelman-then-challenge): *"using the word 'survives' specifically, not 'what do you think'. Phrasing forces a verdict instead of inviting more elaboration."* The same discipline applies to the weekly Socratic question.

**Anti-pattern:** "How are you feeling about it?" — invites elaboration without verdict. The Socratic question must demand a position, not invite reflection on the position. This is the difference between Chris and a generic AI journaling app.

**Empirical support for single-question:** [Socratic Journal Method](https://mindthenerd.com/the-socratic-journal-method-a-simple-journaling-method-that-actually-works/), [reasonrefine.com 7-day Socratic journaling](https://reasonrefine.com/my-7-day-socratic-questioning-journal/) — both converge on **one question per session** as the unit of effective Socratic dialogue. Multi-question = survey.

**Single-question runtime enforcement.** The spec mandates rejection-and-regenerate of multi-question outputs. Implementation note: token-count check on `?` characters in the model output is brittle (handles French/Russian punctuation poorly: `?`, `？`). Better: regex `/[?？！‽]/g` count + Haiku post-validator if count > 1. **Single regex first; Haiku as fallback only if regex misses cases in real use.** Mirrors D039 (no Haiku fallback in fast path until real-world miss rate is measurable).

**Verdict:** TABLE STAKES — exactly one question per the spec; phrased to force a verdict ("which survives", "what does this suggest", "how confident are you now"); regex-based runtime check on `?` count with regenerate on multi-question. DIFFERENTIATOR — explicit question-style taxonomy (open / forecast / decision-archive) selected by Sonnet conditionally on observation type.

---

### 3.3 Sunday evening vs Monday morning vs Friday (TABLE STAKES — Sunday evening default, configurable)

**Evidence from comparable systems:**
- [todoist.com weekly review](https://www.todoist.com/productivity-methods/weekly-review) — Sunday evening to "close out the week with reflection and start Monday with clear intentions"
- [Steven Michels in The Startup](https://medium.com/swlh/the-best-day-for-your-weekly-review-836894682dd0) — Monday morning ("review with fresh eyes")
- [lazyslowdown.com](https://lazyslowdown.com/why-i-recommend-weekly-planning-on-friday-not-on-sunday/) — Friday afternoon ("don't let the weekend cycle the week")
- GTD canon — Friday afternoon
- [theintentionhabit.com](https://theintentionhabit.com/weekly-reflection-questions/) — "key is consistency, not the specific day"

**The deciding factor for Chris:** the weekly review consumes the *just-ended* week's M008 summaries and M007 decisions. Sunday evening means the M008 cron has run for Saturday (at 23:00 Saturday) and Sunday's data is partially fresh — closest to "the week is done" without truncating Sunday's deposits. Monday morning works equally well as long as the cron offset is right. Friday rejects Saturday/Sunday data — wrong for Chris.

**Decision: Sunday evening default; configurable `rituals.config.day_of_week` and `rituals.config.fire_at`.** Default `rituals.config.day_of_week = "sunday"`, `rituals.config.fire_at = "20:00"`. Deliberately one hour earlier than the daily voice note (21:00) so the two rituals don't collide on Sunday.

**Verdict:** TABLE STAKES — Sunday 20:00 local default. Configurable from day one via `rituals.config.day_of_week` and `rituals.config.fire_at`. The cadence machinery must support arbitrary day-of-week + time-of-day for any weekly ritual (forward-compatibility with M013's monthly devil's advocate, quarterly recalibration).

---

### 3.4 Should weekly review surface M007 forecasts that resolved this week? (TABLE STAKES)

This is the highest-leverage integration with M007. **Two scenarios:**

- **Forecast resolved this week** (Greg's prediction was tested by reality this week). The accuracy stat is in `decisions` projection. Should the weekly review include this?
- **Forecast pending** (decision is open, `resolve_by` not yet hit). Already handled by M007's decision-deadline trigger. Should the weekly review *also* mention it?

**Recommendation:** YES on resolved-this-week (it's the empirical-correction loop the PRD calls "the keystone"). NO on pending (M007 already has its own channel — `accountability_outreach` — and double-mentioning creates noise). The weekly review is for *reflection on the just-ended week*; an open forecast isn't an event of this week, it's an open thread.

**Concrete shape.** When ≥1 forecast resolved this week, the observation prompt MAY pull from `decisions` projection where `resolved_at` falls in the week window. In that case, the observation is decision-archive-flavored (style 3 from §3.2). When 0 forecasts resolved, the observation falls back to episodic-summary + wellbeing trajectory.

**Verdict:** TABLE STAKES — weekly review reads `decisions` projection for `resolved_at IN week_window`. When ≥1, prefer decision-archive-style observation. ANTI-FEATURE — do NOT mention pending/open decisions in the weekly review (M007's accountability channel handles that loop).

---

## 4 — Skip-Tracking & Adjustment Dialogue

### 4.1 Is 3 the right threshold? (TABLE STAKES — 3 for daily, but cadence-aware revision)

**Habit-loop research:**
- [James Clear / Atomic Habits "Never Miss Twice" rule](https://jamesclear.com/habit-tracker) — *"Missing once is an accident. Missing twice is the start of a new habit."* This is the most cited threshold in habit literature.
- [Habitica](https://habitica.fandom.com/wiki/Streaks) — streak resets immediately on miss (no buffer). Frustration → abandonment.
- [Streaks app](https://thedolceway.com/blog/streak-habit-tracker), [LifePace, SimpleStreaks](https://habi.app/insights/best-streak-tracker-apps/) — newer apps offer 1-day grace ("never miss twice" tracker).
- BJ Fogg / Tiny Habits — emphasis on celebration + recovery, not threshold counts.

**Why the spec's "3 consecutive skips" works for Chris specifically (not 2):**
- Chris is NOT a streak app. The point of skip tracking is NOT shame; it's **signal that the ritual is wrong** (per the PRD: *"if a ritual is consistently skipped, the ritual is wrong, not John"*).
- 2 skips for a daily ritual = 2 days = noise (one weekend trip, one sick day).
- 3 skips for a daily ritual = 3 days = signal (a pattern, not an accident).
- **For weekly rituals** 3 skips = 3 weeks ≈ 21 days. That's far too long. The threshold should scale to cadence.

**Recommendation:** keep "3 consecutive skips" for daily rituals but **scale by cadence**:

| Cadence | Skip threshold | Rationale |
|---|---|---|
| Daily | 3 consecutive | ~3 days, matches the PRD's existing spec |
| Weekly | 2 consecutive | ~2 weeks; the lighter cadence makes 1 forgivable, 2 a pattern |
| Monthly | 2 consecutive | ~2 months; same logic |
| Quarterly | 1 (any skip) | Single skip = miss the entire ritual; trigger immediately |

**Verdict:** TABLE STAKES — 3 consecutive for daily (per spec). DIFFERENTIATOR — cadence-scaled threshold table above; encoded as `rituals.config.skip_threshold` with default per cadence at row creation. ANTI-FEATURE — punitive "streak loss" UX (Chris is not Habitica; per Atomic Habits research, [habi.app](https://habi.app/insights/best-streak-tracker-apps/), streak-loss UX accelerates abandonment).

---

### 4.2 `rituals.config` JSONB schema (TABLE STAKES — bound the blob)

The risk of JSONB blob: it becomes arbitrary, ungoverned, and fragile. The spec calls out three example user inputs that the Haiku-parser must handle: *"fire later in the day", "skip weekends", "different prompts"*.

**Proposed bounded schema for `rituals.config`** (validated by Zod at write time; existing M007 / M008 chokepoint pattern, e.g. `transitionDecision`):

```typescript
type RitualConfig = {
  // Scheduling
  fire_at?: string;           // "HH:MM" 24h local; default per cadence
  day_of_week?: 0|1|2|3|4|5|6; // Sunday=0; weekly+ only
  day_of_month?: 1|2|3|...|28; // monthly+ only; capped at 28 for DST/month-length safety
  skip_days?: (0|1|2|3|4|5|6)[]; // e.g. [0, 6] = "skip weekends"
  timezone?: string;          // IANA TZ name; default Europe/Paris (Greg)

  // Skip-tracking
  skip_threshold?: number;    // default 3 daily / 2 weekly / 2 monthly / 1 quarterly
  skip_action?: 'adjust_dialogue' | 'pause' | 'disable'; // default 'adjust_dialogue'

  // Daily voice note specific
  prompt_pool?: number[];     // indices into hardcoded prompts (currently 1–6); default [1,2,3,4,5,6]
  prompt_history?: number[];  // last N fired (for cooldown rule); managed by scheduler

  // Wellbeing snapshot specific
  dimensions?: ('energy' | 'mood' | 'anxiety')[]; // default all three; allows opt-out

  // Metadata
  schema_version: 1;
  last_user_modified?: string; // ISO timestamp of last Haiku-parsed change
};
```

**Why this works:** every user-natural-language input maps to ≤1 field. "Fire later in the day" → `fire_at`. "Skip weekends" → `skip_days: [0, 6]`. "Different prompts" → `prompt_pool` subset (hard-cap to existing prompt indices; do NOT allow Greg to write prompts to JSONB — that's a different feature, defer). Haiku parser returns a partial `RitualConfig` patch; engine validates with Zod and rejects unknown fields (chokepoint).

**Verdict:** TABLE STAKES — bounded Zod-validated schema per above; rejection of unknown fields. DIFFERENTIATOR — schema_version field for forward migration when M013 adds quarterly-specific fields. ANTI-FEATURE — free-text custom prompts written by Greg via Haiku-parsed natural language (defer; opens a major test-surface and conflicts with the curated 6-prompt design).

---

### 4.3 What does the adjustment dialogue itself look like? (TABLE STAKES)

The spec: *"Chris surfaces 'this ritual isn't working — what should change?' instead of firing the standard prompt."*

**Three constraints derived from existing M006/M007 patterns:**
- Honor D027 (The Hard Rule) — no flattery in the dialogue. *"You've been brilliant about this; just one tweak..."* — forbidden.
- Honor M006 refusal handling — if Greg replies "drop it / disable / mute", parse via existing refusal regex and disable the ritual (don't re-prompt for adjustment).
- Honor 3-turn cap from M007 decision capture — if Greg's response is ambiguous after 1 clarification turn, default to "I'll pause this ritual for a week and re-ask" (graceful degradation; no insistence).

**Verdict:** TABLE STAKES — single message format ("This ritual isn't working — what should change? You can also tell me to disable or pause it"); Haiku-parsed; 3-turn cap; refusal-respecting per M006; pause-default on ambiguous parse.

---

## 5 — Ritual Infrastructure

### 5.1 Build cadence machinery for all 4 enums in M009? (TABLE STAKES)

The spec table includes `daily / weekly / monthly / quarterly` as enum values from day one, but M009 only ships daily + weekly rituals. M013 adds monthly + quarterly.

**Two paths:**
- **Path A: enum supports all 4, scheduler handles all 4 from day one, M013 just registers ritual rows.** Cleaner; one scheduler implementation; M013 becomes pure ritual content + prompt work.
- **Path B: enum supports all 4, scheduler handles only daily + weekly in M009, M013 extends scheduler.** Defers complexity but creates a non-trivial M009→M013 migration.

**Industry pattern.** Cron-style schedulers ([Google Cloud Scheduler](https://cloud.google.com/scheduler/docs/configuring/cron-job-schedules), [AWS EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-scheduled-rule-pattern.html), [SRE book on distributed cron](https://sre.google/sre-book/distributed-periodic-scheduling/)) all converge on **one scheduler primitive that handles arbitrary cron expressions**, not per-cadence specialized code. The right primitive for Chris is *not* cron syntax (overkill), but a generic `next_run_at` calculator that takes (cadence, config) and returns the next firing time.

**Recommendation: Path A.** The cadence calculator in `src/proactive/rituals.ts` should be `nextRunAt(cadence, config, lastRunAt) → Date` and handle all 4 cadences from day one. Adding cadences post-launch means schema migration; getting them right at table-creation time is essentially free.

**Pseudo-implementation per cadence (DST-safe via existing M008 timezone-aware sweep cap):**
- Daily: `nextRunAt = today @ config.fire_at if past, else tomorrow @ config.fire_at`
- Weekly: `nextRunAt = next config.day_of_week >= today @ config.fire_at`
- Monthly: `nextRunAt = first weekend of next month @ config.fire_at` (M013 spec: "first weekend of the month")
- Quarterly: `nextRunAt = last weekend of next quarter @ config.fire_at` (M013 spec: "last weekend of each quarter")

**Verdict:** TABLE STAKES — cadence enum supports all 4 from day one (matches spec). DIFFERENTIATOR — scheduler primitive `nextRunAt(cadence, config, lastRunAt)` handles all 4 cadences in M009; M013 only registers ritual rows + writes ritual content + prompts. ANTI-FEATURE — cron-expression-based config (overkill; opaque; opens parsing surface).

---

### 5.2 Coexistence with reactive triggers (TABLE STAKES)

The spec is clear: "Reactive triggers (silence, commitment, pattern, thread) remain unchanged; both coexist." M007 added a 5th trigger (decision-deadline) with priority 2. M009 adds rituals as a 6th trigger? Or as a separate code path?

**Two architectures:**
- **A: Rituals as a 6th trigger in the existing 5-trigger priority order.** Pro: one execution path; one daily-cap budget. Con: ritual firing conditions ("`next_run_at` has passed") are different in kind from reactive trigger conditions ("Greg has been silent for X hours") — overloading them muddies the priority logic.
- **B: Rituals are a separate orchestrator path within proactive sweep, running before the trigger evaluation.** Pro: clean separation of "scheduled" vs "reactive". Con: two daily-cap counters? Or shared?

**Recommendation: B with a shared daily cap.** Rituals are scheduled, not reactive. They fire on `next_run_at` regardless of conversation state (subject to mute control per M004 — `mute_until` honored). Reactive triggers continue to fire as today. Both contribute to a single shared daily-cap counter so Greg never gets > N proactive messages per day total.

**Channel separation** (M007 D-04 pattern): rituals fire on the existing `reflective_outreach` channel by default. The weekly review and adjustment dialogue both stay in `reflective_outreach`. Decision-deadline trigger keeps `accountability_outreach` exclusively. **Do not add new channels in M009.**

**Verdict:** TABLE STAKES — rituals run as a separate scheduler path within proactive sweep; shared daily-cap counter with reactive triggers; honors `mute_until`; uses existing `reflective_outreach` channel.

---

### 5.3 Idempotency (TABLE STAKES)

**Problem.** Sweep runs every cron tick (e.g. every hour). If a ritual's `next_run_at` is in the past at tick T1 and again at T2 (because no one updated `last_run_at`), the ritual could fire twice.

**Pattern from M008** (D034: `UNIQUE(summary_date)` + idempotent SELECT-then-INSERT-if-absent). M007 has the same: `upsertAwaitingResolution` (D-28 write-before-send ordering).

**Solution.** Atomic update: `UPDATE rituals SET last_run_at = NOW(), next_run_at = <calculated> WHERE id = X AND next_run_at <= NOW() RETURNING *;` If the RETURNING returns 0 rows, another sweep already fired this ritual; abort. If it returns 1 row, fire the ritual. Then send the Telegram message *after* the database update commits (write-before-send, per D-28).

**Verdict:** TABLE STAKES — atomic UPDATE...RETURNING idempotency pattern; write-before-send ordering. Mirrors M007 D-28. Failure to honor → duplicate prompts on race conditions.

---

### 5.4 Wellbeing snapshot table schema (TABLE STAKES — additive constraint)

Spec: `id, snapshot_date, energy (1–5), mood (1–5), anxiety (1–5), notes (nullable), created_at`.

**One additive recommendation:** `UNIQUE(snapshot_date)` constraint, mirroring M008's `episodic_summaries.UNIQUE(summary_date)` (D034). One snapshot per day; second tap-set within the same day = UPDATE not INSERT (lets Greg correct after-the-fact). Index implications: btree on `snapshot_date` for the rolling-7-day query in weekly review. No GIN needed.

**Verdict:** TABLE STAKES — schema as specified + `UNIQUE(snapshot_date)` + btree index on `snapshot_date`.

---

## 6 — Consolidated Synthesis

### 6.1 Feature Landscape

#### Table Stakes (must include — 14 items)

| # | Feature | Why Expected | Complexity | Notes |
|---|---|---|---|---|
| TS-1 | Daily voice note: deposit-only, no Chris response | Habit-survival (70% abandonment lit); D026 already locked | LOW (one engine flag) | Bypass JOURNAL-mode follow-up logic when entry is ritual response |
| TS-2 | 6 rotating prompts, no consecutive duplicates | Spec; covers 6 reflection dimensions | LOW | Prompts already enumerated in spec |
| TS-3 | Default fire-at 21:00 local, configurable | Evening journaling research; implementation-intention anchoring | LOW | `rituals.config.fire_at`; existing TZ-aware infra |
| TS-4 | Wellbeing 1–5 scale × 3 dimensions | PROMIS clinical validation; Daylio retention rationale | LOW | Spec confirmed |
| TS-5 | Single Telegram message with 3-row inline keyboard | UX best practice (anti-clutter); D026 separate from voice note ritual | LOW-MEDIUM | callback_data parsing |
| TS-6 | Weekly review: exactly 1 observation + 1 question | Spec; Socratic Journal lit | MEDIUM | Token-count regex enforcement; regenerate on multi-Q |
| TS-7 | Observation sourced from M008 + M007 | D031/D035 boundary; D036 routing | MEDIUM | Use existing `getEpisodicSummariesRange`, decisions projection |
| TS-8 | D031 boundary marker on observation header | "Interpretation, not fact" | LOW | Mirror INTERROGATE pattern |
| TS-9 | Sunday 20:00 default, configurable | Comparable systems consensus | LOW | `day_of_week` + `fire_at` config |
| TS-10 | 3-skip threshold for daily; cadence-scaled for others | "Never miss twice" + signal-vs-shame framing | LOW-MEDIUM | per-cadence default in row creation |
| TS-11 | Bounded Zod-validated `rituals.config` schema | Prevents ungoverned blob | MEDIUM | 8 fields, schema_version, partial-patch via Haiku |
| TS-12 | Rituals enum supports all 4 cadences from day one | Forward-compat M013 | LOW (DDL) | M013 just adds rows + content |
| TS-13 | Atomic `UPDATE...RETURNING` idempotency | Race-condition safety; D-28 pattern | LOW | One-line query change vs naive SELECT-then-UPDATE |
| TS-14 | `wellbeing_snapshots.UNIQUE(snapshot_date)` + btree index | Mirror M008 D034 | LOW | Migration only |

#### Differentiators (would set Chris apart — 6 items)

| # | Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|---|
| DIFF-1 | Cooldown rule: no prompt repeat in last 3 (extends "no consecutive duplicates") | Reduces prompt-fatigue with 6-prompt pool | LOW | `rituals.config.prompt_history: int[3]` |
| DIFF-2 | Wellbeing trajectory as 3rd weekly-observation source | Ties numeric series back into reflection loop | MEDIUM | Mean / variance / direction over rolling 7-day |
| DIFF-3 | Question-style taxonomy: open-Socratic / forecast / decision-archive | Style selected by data shape; richer than fixed format | MEDIUM | Sonnet conditional in observation prompt |
| DIFF-4 | Cadence-scaled skip thresholds (daily 3, weekly 2, monthly 2, quarterly 1) | Threshold matches signal density per cadence | LOW | Default per cadence in row creation |
| DIFF-5 | Forecast-resolved-this-week → decision-archive-style observation | Closes the M007 keystone loop weekly, not just at deadline | LOW (existing data) | Read `decisions.resolved_at IN week_window` |
| DIFF-6 | Generic `nextRunAt(cadence, config, lastRunAt)` scheduler primitive | M013 becomes content-only, no scheduler work | MEDIUM | DST-safe via existing TZ-aware sweep cap |

#### Anti-Features (commonly requested, don't build — 10 items)

| # | Feature | Why Surface-Appealing | Why Problematic | Alternative |
|---|---|---|---|---|
| ANTI-1 | AI follow-up question after voice deposit | "Deeper data" | Kills the habit (70% abandonment lit, D026) | Deposit-only; conversation is opt-in via JOURNAL afterward |
| ANTI-2 | Gratitude as 7th prompt | Five Minute Journal precedent; well-being benefits | Off-brand for Chris's anti-flattery constitution; over-fits journaling-app niche | Keep the curated 6 |
| ANTI-3 | Server-side Whisper transcription | Voice → text without keyboard friction | Transcription error pollutes Pensieve; PLAN.md already defers | Android keyboard STT (Greg reviews + edits) |
| ANTI-4 | Last-message-time fire-at heuristic | Adapts to Greg's rhythm | Brittle, non-deterministic, complex; D041-flavor problem | Fixed 21:00 default, configurable knob |
| ANTI-5 | Real-time wellbeing interpretation back to Greg at deposit | "Insightful" feel | Pollutes data (Goodhart's law); D026 separation | Delayed/cumulative use in weekly review + M013 reconciliation |
| ANTI-6 | Slider UX for wellbeing | Higher resolution | Awkward on Telegram inline keyboard; PROMIS 1–5 already validated | 5-button keyboard rows |
| ANTI-7 | Streak-loss UX for skip tracking | Habitica/Streaks visual reinforcement | Punitive; accelerates abandonment per habit-tracker UX research | Skip count as private signal; surfaces only at threshold |
| ANTI-8 | Mention pending/open M007 forecasts in weekly review | "Closing the loop" | Double-mentions with M007's accountability channel; creates noise | Resolved-this-week only |
| ANTI-9 | Cron-expression-based ritual config | Industry standard (cron syntax) | Opaque to Greg; opens a parsing surface; overkill | Bounded JSONB with named fields |
| ANTI-10 | Free-text custom prompts written via Haiku natural language | Personalization | Major test-surface; conflicts with curated prompt design; opens prompt-injection adjacent risks | `prompt_pool` subset of curated 6 only; defer |

### 6.2 Feature Dependencies

```
M008 episodic_summaries  ─┐
                          ├──> Weekly Review observation generator
M007 decisions projection ─┤
                          │
TS-13 atomic UPDATE...RETURNING ──┐
                                  ├──> Daily voice note ritual fires
TS-3 fire_at 21:00 default ───────┤
                                  │
TS-1 deposit-only behavior ────────────────> Daily voice note "deposit and silence"
                          │
                          ├──> Wellbeing snapshot delivered after voice prompt
TS-5 inline keyboard ─────┘
                          │
TS-14 wellbeing_snapshots schema ──> Storage path
                          │
                          ├──> DIFF-2 weekly trajectory observation
TS-7 observation sources ─┘

TS-12 4-cadence enum ──> M013 adds monthly + quarterly RITUAL ROWS only
DIFF-6 nextRunAt primitive ─────^

TS-10 3-skip threshold ──┐
TS-11 rituals.config Zod ─┼──> Adjustment dialogue
M006 refusal handling ────┘
```

### 6.3 Dependency notes

- **Weekly review requires M008 + M007:** Already shipped. `getEpisodicSummariesRange` substrate exists per PLAN.md tech-debt; `decisions` projection exists. M009 phase wires them; no new substrate needed.
- **Daily voice note requires JOURNAL-mode bypass flag:** Existing JOURNAL handler may emit a chat reply in some paths; M009 must add a `is_ritual_response` flag that suppresses follow-up generation while still triggering store + epistemic tag + embedding (M001 fire-and-forget pipeline unchanged).
- **Wellbeing → weekly review enhancement is optional but high-value:** DIFF-2. If shipped, weekly review prompt has 3 source dimensions (M008, M007, wellbeing) instead of 2.
- **Skip-tracking adjustment dialogue requires M006 refusal handling:** Refusal regex must apply inside the dialogue path (Greg saying "drop it" must disable, not loop).
- **Cadence machinery in M009 unblocks M013:** TS-12 + DIFF-6 mean M013 ships content + prompts only, not scheduler code.

### 6.4 MVP Definition

#### Launch with v2.4 M009 (must-have)

- [x] All 14 TABLE STAKES items above (TS-1 through TS-14)
- [ ] DIFF-1 cooldown rule (5-LOC addition; effectively free)
- [ ] DIFF-6 scheduler primitive (M013 unblock)

#### Add after validation (v2.5–v2.7)

- [ ] DIFF-2 wellbeing trajectory in observation generator (after 30 days of real data per D029 pause)
- [ ] DIFF-3 question-style taxonomy (after enough weekly reviews to see which style works)
- [ ] DIFF-4 cadence-scaled skip thresholds (relevant only when M013 monthly + quarterly land)
- [ ] DIFF-5 forecast-resolved-this-week observations (relevant after enough M007 forecasts have resolved)

#### Future / out of scope for M009

- [ ] Free-text custom prompts (ANTI-10; defer indefinitely)
- [ ] Slider wellbeing UX (ANTI-6; defer; revisit only if 1–5 satisficing observed)
- [ ] AI commentary mode on voice notes (ANTI-1; explicitly forbidden by D026)
- [ ] Server-side Whisper (ANTI-3; PLAN.md defers; revisit only after a "review-before-store" flow exists)

### 6.5 Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| TS-1 deposit-only voice note | HIGH | LOW | P1 |
| TS-2 6 rotating prompts no-consec-dup | HIGH | LOW | P1 |
| TS-3 21:00 default + configurable | HIGH | LOW | P1 |
| TS-4 1–5 wellbeing scale | HIGH | LOW | P1 |
| TS-5 inline keyboard 3-row single message | MEDIUM | LOW-MEDIUM | P1 |
| TS-6 weekly review one obs + one Q | HIGH | MEDIUM | P1 |
| TS-7 obs from M008 + M007 | HIGH | MEDIUM | P1 |
| TS-8 D031 boundary marker | MEDIUM | LOW | P1 |
| TS-9 Sunday 20:00 default | MEDIUM | LOW | P1 |
| TS-10 3-skip threshold | HIGH | LOW-MEDIUM | P1 |
| TS-11 Zod rituals.config | MEDIUM | MEDIUM | P1 |
| TS-12 4-cadence enum | MEDIUM (M013) | LOW | P1 |
| TS-13 atomic idempotency | HIGH (correctness) | LOW | P1 |
| TS-14 wellbeing UNIQUE date | MEDIUM | LOW | P1 |
| DIFF-1 cooldown rule | LOW-MEDIUM | LOW | P1 (effectively free) |
| DIFF-6 scheduler primitive | HIGH (M013 unblock) | MEDIUM | P1 |
| DIFF-2 wellbeing trajectory in obs | MEDIUM | MEDIUM | P2 |
| DIFF-3 question-style taxonomy | MEDIUM | MEDIUM | P2 |
| DIFF-4 cadence-scaled skip thresholds | LOW (until M013) | LOW | P2 |
| DIFF-5 forecast-resolved obs | MEDIUM | LOW (existing data) | P2 |
| ANTI-1..10 | n/a | n/a | OUT OF SCOPE |

### 6.6 Competitor / Comparable System Analysis

| Behavior | Five Minute Journal | Day One | Stoic | Daylio | How We Feel | Reflect.app | **Chris (M009)** |
|---|---|---|---|---|---|---|---|
| Daily prompt | Fixed AM+PM | Open canvas | Curated rotating | None (mood only) | Mood meter | AI-generated daily | **6 rotating, deposit-only** |
| AI response to entry | None | Optional add-on | None | None | None | Always (GPT-4) | **None — D026** |
| Mood scale | None | Tags | 1–5 emoji | 1–5 emoji | 4-quadrant + 144 words | None | **1–5 numeric × 3 dimensions** |
| Weekly review | Manual reflection | Manual | Some templates | Activity correlations | Wellbeing assessment | GPT-4 digest | **1 observation + 1 Socratic question** |
| Skip tracking | None | None | Streak | Streak | None | None | **3-skip → adjustment dialogue (PRD-unique)** |
| Multi-question rejection | n/a | n/a | n/a | n/a | n/a | n/a | **Runtime-enforced (PRD-unique)** |

The combination — deposit-only daily + dimensional wellbeing + single-question weekly review + skip-tracking that triggers reconfiguration rather than shame — is **not present in any single comparable system**. Each piece has precedent; the assembly is Chris's contribution.

---

## Sources

- Spec / context (existing project files):
  - `PLAN.md` (M009 milestone definition; D026, D029, D030, D041 decision rationales)
  - `M009_Ritual_Infrastructure.md` (target features and acceptance criteria)
  - `M013_Monthly_Quarterly_Rituals.md` (forward dependency: monthly + quarterly cadence reuse, devil's advocate, recalibration)
  - `M010_Operational_Profiles.md`, `M011_Psychological_Profiles.md` (downstream wellbeing-data consumers)
  - `PRD_Project_Chris.md` (4-layer anti-sycophancy; ritual cadence; 3 forbidden behaviors)

- Journaling app retention / abandonment:
  - [70% lifestyle/MH app abandonment in 100d, mylifenote.ai review](https://blog.mylifenote.ai/abandonment-journal-prompts/)
  - [Lume Journal — 4 mental blocks](https://lumejournalapp.com/why-cant-i-stick-to-journaling/)
  - [Why Most People Fail at Journaling — that journaling guy](https://thatjournalingguy.substack.com/p/why-most-people-fail-at-journaling)
  - [Affirmations Flow — Why You Quit Journaling After 3 Days](https://www.affirmationsflow.com/blog/why-you-quit-journaling-after-3-days-and-the-stack-and-scale-fix)
  - [Practical PKM — Eliminate Journaling Friction with Daily Questions](https://practicalpkm.com/eliminate-the-journaling-friction-with-daily-questions/)

- Comparable systems (deposit-only / curated prompts):
  - [Stoic — getstoic.com](https://www.getstoic.com/) and [Stoic 6 prompts blog](https://www.getstoic.com/blog/6-journaling-prompts-to-cultivate-the-quiet-discipline-of-reflection)
  - [Five Minute Journal — Tim Ferriss tweet](https://x.com/tferriss/status/1937337697313472550), [Intelligent Change](https://www.intelligentchange.com/blogs/read/the-five-minute-journal-questions)
  - [Reflect.app review — Otio](https://otio.ai/blog/reflect-app-review)
  - [Day One — Building a Journaling Habit](https://dayoneapp.com/blog/journaling-habit/)

- EMA / scale granularity:
  - [Frontiers EMA systematic review (Likert designs in mood/anxiety EMA)](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.642044/full)
  - [Springer 2025 — Likert vs VAS in EMA](https://link.springer.com/article/10.3758/s13428-025-02706-2)
  - [PROMIS Anxiety Scoring Manual (5-point Likert clinical validation)](https://www.healthmeasures.net/images/PROMIS/manuals/Scoring_Manuals_/PROMIS_Anxiety_Scoring_Manual.pdf)
  - [PROMIS clinical validity — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4928679/)
  - [Daylio mood-quantification PMC paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC5344152/), [Daylio: How to Track Moods](https://daylio.net/how-to-track-moods/), [Daylio Wikipedia](https://en.wikipedia.org/wiki/Daylio)
  - [How We Feel app](https://howwefeel.org/), [Yale article on the Mood Meter / circumplex model](https://medicine.yale.edu/news-article/the-how-we-feel-app-helping-emotions-work-for-us-not-against-us/)

- Habit / streak / skip threshold:
  - [James Clear — Habit Tracker (Never Miss Twice)](https://jamesclear.com/habit-tracker)
  - [Habi.app — 7 Best Streak Trackers](https://habi.app/insights/best-streak-tracker-apps/)
  - [Habitica wiki — Streaks](https://habitica.fandom.com/wiki/Streaks)
  - [The Dolce Way — Streak Habit Tracker](https://thedolceway.com/blog/streak-habit-tracker)

- Weekly review timing / structure:
  - [Todoist — The Weekly Review](https://www.todoist.com/productivity-methods/weekly-review)
  - [Steven Michels — Best Day for Your Weekly Review (Medium)](https://medium.com/swlh/the-best-day-for-your-weekly-review-836894682dd0)
  - [Lazy Slowdown — Weekly planning Friday not Sunday](https://lazyslowdown.com/why-i-recommend-weekly-planning-on-friday-not-on-sunday/)
  - [The Intention Habit — Weekly Reflection Questions](https://theintentionhabit.com/weekly-reflection-questions/)
  - [Roam weekly review template — gist](https://gist.github.com/jborichevskiy/51508eebc810ae8105be45beac4e16ac)

- Socratic questioning:
  - [Mind The Nerd — Socratic Journal Method](https://mindthenerd.com/the-socratic-journal-method-a-simple-journaling-method-that-actually-works/)
  - [Reason Refine — 7-Day Socratic Questioning Journal](https://reasonrefine.com/my-7-day-socratic-questioning-journal/)
  - [PositivePsychology.com — Socratic Questioning](https://positivepsychology.com/socratic-questioning/)

- Reflection prompt design:
  - [PositivePsychology.com — 30 Best Journaling Prompts](https://positivepsychology.com/journaling-prompts/)
  - [Reflection.app — 10 Journaling Techniques + 50 Prompts](https://www.reflection.app/blog/journaling-techniques)
  - [Rosebud — Gratitude Prompts (target/lens/angle framework)](https://www.rosebud.app/blog/gratitude-journal-prompts)
  - [JournalingInsights — Daily Reflection Prompts Generator](https://journalinginsights.com/how-to-use-a-journaling-prompts-generator-for-daily-reflection/)

- Survey / tap fatigue:
  - [LogRocket — Survey Fatigue](https://blog.logrocket.com/ux-design/what-is-survey-fatigue-how-can-you-avoid-it/)
  - [PMC — Survey Fatigue in Questionnaire Research](https://pmc.ncbi.nlm.nih.gov/articles/PMC11833437/)

- Cron / scheduler patterns:
  - [Google Cloud Scheduler — cron format](https://cloud.google.com/scheduler/docs/configuring/cron-job-schedules)
  - [AWS EventBridge — scheduled rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-scheduled-rule-pattern.html)
  - [Google SRE Book — Distributed Periodic Scheduling](https://sre.google/sre-book/distributed-periodic-scheduling/)
  - [Medium — Recurring Calendar Events Database Design](https://medium.com/@aureliadotlim/recurring-calendar-events-database-design-dc872fb4f2b5)

---
*Feature research for: M009 Ritual Infrastructure + Daily Note + Weekly Review (MVP shipping point, soul-system milestone 4 of 9)*
*Researched: 2026-04-26*
