---
status: partial
phase: 34-inference-engine
source: [34-VERIFICATION.md]
started: 2026-05-12T20:40:00Z
updated: 2026-05-13T01:45:00Z
---

## Current Test

[deployed 2026-05-13 01:43 UTC; item 2 resolved via live curl; awaiting first Sunday 22:00 Paris fire on 2026-05-17 (4 days from deploy)]

## Deploy Record

- **Deployed:** 2026-05-13 01:43 UTC (Proxmox 192.168.1.50, container `chris-chris-1`)
- **HEAD shipped:** `484cbe0` (docs(phase-34): evolve PROJECT.md after phase completion)
- **Boot log confirms `profile.cron.scheduled`** with `cron='0 22 * * 0'` + `timezone='Europe/Paris'`
- **Phase 33 seed state intact at deploy:** `profile_jurisdictional.substrate_hash = ''` + `confidence = 0.3` → first Sunday fire will regenerate from substrate (empty hash never matches a real SHA-256, per CONTEXT.md D-11+D-18)
- **First fire ETA:** Sunday 2026-05-17 22:00 Europe/Paris = 20:00 UTC

## Tests

### 1. First Sunday 22:00 Paris production cron fire post-deploy
expected: After deploying the Phase 34 container to Proxmox (`192.168.1.50`), the next Sunday at 22:00 Paris (4h after the M009 weekly_review fire at 20:00) the `updateAllOperationalProfiles` cron should fire. Expected log signature in `docker logs chris-chris-1`:
- 1× `chris.profile.cron.start` (or `profile.cron.scheduled` registration line at boot)
- 4× per-dimension outcome events (`chris.profile.profile_updated` or `chris.profile.profile_skipped_no_change` or `chris.profile.profile_below_threshold` depending on substrate state)
- 1× `chris.profile.cron.complete` with `{summary: {updated: N, skipped: M, below_threshold: K, failed: F}}`

Verification commands (on the live server):
```bash
ssh chris@192.168.1.50 'docker logs chris-chris-1 --since=1h | grep chris.profile'
# Expect: 6+ log lines on the Sunday 22:00 tick (4 per-dimension + 1 aggregate + 1 start)
```

Post-fire DB state checks:
```bash
ssh chris@192.168.1.50 'docker exec chris-postgres-1 psql -U chris -d chris -c "SELECT name, confidence, substrate_hash FROM profile_jurisdictional"'
# Expect: substrate_hash transitions from '' (seed) to 64-hex (first-fire post-Sonnet)
# Expect: confidence > 0 if substrate has ≥ 10 Pensieve entries in the FACT|RELATIONSHIP|INTENTION|EXPERIENCE tag union
```

```bash
ssh chris@192.168.1.50 'docker exec chris-postgres-1 psql -U chris -d chris -c "SELECT COUNT(*) FROM profile_history WHERE profile_table_name = '\''jurisdictional'\''"'
# Expect: 1 row per dimension (4 total) after first successful fire
```

result: [pending]

### 2. `/health` endpoint surfaces `profile_cron_registered: true` post-deploy [RESOLVED 2026-05-13]
expected: After the container restarts with the Phase 34 build, `curl http://192.168.1.50:PORT/health` (whatever port the express server listens on) returns JSON including `profile_cron_registered: true` alongside the other cron-status fields. The field-mapping logic is unit-tested in `src/__tests__/health.test.ts:138-178` against a synthetic `cronStatus` object — production verifies the actual registration succeeds at boot.

Verification command:
```bash
curl -s http://192.168.1.50:PORT/health | jq '.profile_cron_registered'
# Expect: true
```

If the field returns `false`: registration failed at boot — inspect `docker logs chris-chris-1 --since=1h | grep profile.cron`. Most likely cause is `profileUpdaterCron` env var malformed or unset (the `cron.validate` fail-fast should have prevented container start, so seeing `false` means registration silently failed — investigate the registration block at `src/cron-registration.ts:178-188`).

result: PASSED 2026-05-13T01:43:15.830Z. Live `/health` response: `{"status":"ok","checks":{"database":"ok","immich":"ok"},"ritual_cron_registered":true,"profile_cron_registered":true,...}` — confirmed via `curl http://localhost:3000/health` on Proxmox host. Boot log line `profile.cron.scheduled cron='0 22 * * 0' timezone='Europe/Paris'` also confirms underlying registration.

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

(none yet — both items are calendar-time-dependent observations, not code defects)

---

**Why these two items cannot be sandbox-verified:**
- Real cron tick requires calendar-time wait (next Sunday 22:00 Paris) — sandbox cannot make 7 days pass instantly.
- Real Sonnet call requires `ANTHROPIC_API_KEY` set on the production container — sandbox has no API key (per D-30-03 cost discipline; CONTEXT.md D-40 explicitly defers live Sonnet to Phase 36 PTEST-05).
- `/health` endpoint registration check requires the express server to actually boot in the production container with the production env — the test suite mocks node-cron, which is sufficient to verify the field-mapping but not the live-boot path.

These items track normally in `/gsd-progress` and `/gsd-audit-uat` until the operator marks them resolved after Sunday observation. They do NOT block Phase 35 planning (Phase 35 depends on Phase 34's CODE artifacts, which are verified — populated rows for the non-null rendering test arrive after the first production fire, which is itself the verification gate for these UAT items).
