---
phase: 17
slug: decisions-command-accuracy-stats
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-16
---

# Phase 17 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Haiku API response -> classifyAccuracy | Untrusted LLM output parsed as JSON | Model-generated JSON with reasoning classification |
| SQL query -> application | Window parameter from user input (30/90/365) | Integer passed to SQL interval |
| Suppression phrase -> DB delete | User-provided phrase for unsuppress | Text string matched via parameterized query |
| User command text -> sub-command router | Untrusted input parsed for sub-command + args | Telegram message text |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-17-01-01 | Tampering | classifyAccuracy JSON parse | mitigate | `VALID_REASONING.has()` validates parsed value is in Set(['sound','lucky','flawed']); any other value returns 'unknown' (fail-closed D-04) | closed |
| T-17-01-02 | Denial of Service | classifyAccuracy Haiku timeout | mitigate | 5-second `Promise.race` timeout; fail-closed to 'unknown'; entire classify block wrapped in try/catch so resolution flow continues | closed |
| T-17-01-03 | Information Disclosure | User text in Haiku prompt | accept | User text (Greg's resolution account) in `messages[].content` only, never in system prompt; follows existing classifyOutcome pattern | closed |
| T-17-02-01 | Tampering | SQL interval injection via windowDays | mitigate | `windowDays` validated to [30, 90, 365] allowlist in handler before passing to fetchStatsData; `sql.raw(String(windowDays))` only receives validated numeric values | closed |
| T-17-02-02 | Information Disclosure | Stats cross-chat leakage | mitigate | Every query includes `eq(decisions.chatId, chatId)` filter — verified in fetchStatsData, fetchStatusCounts, fetchOpenDecisions, fetchRecentDecisions | closed |
| T-17-02-03 | Tampering | removeSuppression phrase injection | mitigate | Phrase normalized (trim+lowercase) and matched via parameterized `eq()` — no raw SQL | closed |
| T-17-03-01 | Tampering | Window argument injection | mitigate | `parseInt(arg, 10)` validated against `[30, 90, 365]` allowlist; rejected with error message otherwise | closed |
| T-17-03-02 | Information Disclosure | Cross-chat stats leakage (command) | mitigate | All queries in handler use `eq(decisions.chatId, chatIdBig)` — reclassify query included | closed |
| T-17-03-03 | Denial of Service | Reclassify Haiku rate limit | accept | Sequential for...of loop (D-12); Greg-scale (<=20 decisions) makes abuse moot; single-user bot | closed |
| T-17-03-04 | Information Disclosure | Suppression phrase logged | mitigate | Logger writes `{chatId, error.message}` only — never logs the phrase arg itself (follows T-14-05-05 pattern) | closed |

*Status: open / closed*
*Disposition: mitigate (implementation required) / accept (documented risk) / transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-17-01 | T-17-01-03 | User text sent to Haiku API in messages[] content only; follows identical pattern to classifyOutcome; no new data exposure beyond existing resolution flow | Plan author | 2026-04-16 |
| AR-17-02 | T-17-03-03 | Sequential reclassify loop on single-user bot with Greg-scale data (~20 decisions); no rate-limiting needed | Plan author | 2026-04-16 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-16 | 10 | 10 | 0 | gsd-secure-phase |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-16
