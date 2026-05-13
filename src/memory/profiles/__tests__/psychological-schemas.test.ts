/**
 * Phase 37 Plan 37-02 Task 5 (PSCH-06 coverage)
 *
 * Pure-unit tests for the Zod v3 + v4 dual psychological-profile schemas.
 * No DB, no async setup — runs in microseconds.
 *
 * Coverage:
 *   - Cold-start parse: all dimension fields set to `null` (matches the
 *     migration 0013 seed-row jsonb default 'null'::jsonb).
 *   - Populated parse: every dimension set to a valid
 *     { score, confidence, last_updated } shape.
 *   - Boundary tests: score min/max (1.0/5.0 OK, 0.5/5.5 reject); confidence
 *     min/max (0.0/1.0 OK, -0.1/1.1 reject); last_updated valid ISO 8601 OK;
 *     non-ISO string reject.
 *   - .strict() rejects unknown keys: unknown top-level key + unknown
 *     per-dimension key both rejected.
 *   - v3/v4 lockstep parity: same valid populated fixture parses success
 *     under both V3 and V4 schemas (M009 D-29-02 dual-schema discipline).
 */
import { describe, it, expect } from 'vitest';
import {
  HexacoProfileSchemaV3,
  HexacoProfileSchemaV4,
  SchwartzProfileSchemaV3,
  SchwartzProfileSchemaV4,
  AttachmentProfileSchemaV3,
  AttachmentProfileSchemaV4,
} from '../psychological-schemas.js';

// ── Fixture builder ─────────────────────────────────────────────────────

function makeDimensionFixture(
  score: number,
  confidence: number,
  lastUpdated: string,
): { score: number; confidence: number; last_updated: string } {
  return { score, confidence, last_updated: lastUpdated };
}

const VALID_DIM = makeDimensionFixture(3.5, 0.7, '2026-06-01T00:00:00.000Z');

// ── HEXACO fixtures ─────────────────────────────────────────────────────

const validHexacoColdStart = {
  honesty_humility: null,
  emotionality: null,
  extraversion: null,
  agreeableness: null,
  conscientiousness: null,
  openness: null,
};

const validHexacoPopulated = {
  honesty_humility: VALID_DIM,
  emotionality: VALID_DIM,
  extraversion: VALID_DIM,
  agreeableness: VALID_DIM,
  conscientiousness: VALID_DIM,
  openness: VALID_DIM,
};

// ── Schwartz fixtures ───────────────────────────────────────────────────

const validSchwartzColdStart = {
  self_direction: null,
  stimulation: null,
  hedonism: null,
  achievement: null,
  power: null,
  security: null,
  conformity: null,
  tradition: null,
  benevolence: null,
  universalism: null,
};

const validSchwartzPopulated = {
  self_direction: VALID_DIM,
  stimulation: VALID_DIM,
  hedonism: VALID_DIM,
  achievement: VALID_DIM,
  power: VALID_DIM,
  security: VALID_DIM,
  conformity: VALID_DIM,
  tradition: VALID_DIM,
  benevolence: VALID_DIM,
  universalism: VALID_DIM,
};

// ── Attachment fixtures ─────────────────────────────────────────────────

const validAttachmentColdStart = {
  anxious: null,
  avoidant: null,
  secure: null,
};

const validAttachmentPopulated = {
  anxious: VALID_DIM,
  avoidant: VALID_DIM,
  secure: VALID_DIM,
};

// ── HEXACO v3 happy path ────────────────────────────────────────────────

describe('HexacoProfileSchemaV3 — happy path', () => {
  it('cold-start (all 6 dims null) parses successfully', () => {
    const parsed = HexacoProfileSchemaV3.safeParse(validHexacoColdStart);
    expect(parsed.success).toBe(true);
  });

  it('populated (all 6 dims set) parses successfully', () => {
    const parsed = HexacoProfileSchemaV3.safeParse(validHexacoPopulated);
    expect(parsed.success).toBe(true);
  });

  it('populated parse output matches input', () => {
    const parsed = HexacoProfileSchemaV3.parse(validHexacoPopulated);
    expect(parsed.honesty_humility?.score).toBe(3.5);
    expect(parsed.openness?.confidence).toBe(0.7);
  });
});

// ── HEXACO v3 boundary tests ────────────────────────────────────────────

describe('HexacoProfileSchemaV3 — boundary tests', () => {
  it('score 1.0 (min) accepted', () => {
    const fixture = { ...validHexacoPopulated, openness: makeDimensionFixture(1.0, 0.5, '2026-06-01T00:00:00.000Z') };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(true);
  });

  it('score 5.0 (max) accepted', () => {
    const fixture = { ...validHexacoPopulated, openness: makeDimensionFixture(5.0, 0.5, '2026-06-01T00:00:00.000Z') };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(true);
  });

  it('score 0.5 (below min) rejected', () => {
    const fixture = { ...validHexacoPopulated, openness: makeDimensionFixture(0.5, 0.5, '2026-06-01T00:00:00.000Z') };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });

  it('score 5.5 (above max) rejected', () => {
    const fixture = { ...validHexacoPopulated, openness: makeDimensionFixture(5.5, 0.5, '2026-06-01T00:00:00.000Z') };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });

  it('confidence 0.0 (min) accepted', () => {
    const fixture = { ...validHexacoPopulated, openness: makeDimensionFixture(3.0, 0.0, '2026-06-01T00:00:00.000Z') };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(true);
  });

  it('confidence 1.0 (max) accepted', () => {
    const fixture = { ...validHexacoPopulated, openness: makeDimensionFixture(3.0, 1.0, '2026-06-01T00:00:00.000Z') };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(true);
  });

  it('confidence -0.1 (below min) rejected', () => {
    const fixture = { ...validHexacoPopulated, openness: makeDimensionFixture(3.0, -0.1, '2026-06-01T00:00:00.000Z') };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });

  it('confidence 1.1 (above max) rejected', () => {
    const fixture = { ...validHexacoPopulated, openness: makeDimensionFixture(3.0, 1.1, '2026-06-01T00:00:00.000Z') };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });

  it('last_updated valid ISO 8601 accepted', () => {
    const fixture = { ...validHexacoPopulated, openness: makeDimensionFixture(3.0, 0.5, '2026-12-31T23:59:59.999Z') };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(true);
  });

  it('last_updated non-ISO string rejected', () => {
    const fixture = { ...validHexacoPopulated, openness: makeDimensionFixture(3.0, 0.5, 'not-iso') };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });
});

// ── HEXACO v3 .strict() unknown-key rejection ───────────────────────────

describe('HexacoProfileSchemaV3 — .strict() rejects unknown keys', () => {
  it('unknown top-level key rejected', () => {
    const fixture = { ...validHexacoPopulated, extra: 'wat' };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });

  it('unknown per-dimension key rejected', () => {
    const fixture = {
      ...validHexacoPopulated,
      openness: { ...VALID_DIM, extra: 'wat' },
    };
    expect(HexacoProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });
});

// ── HEXACO v4 lockstep parity ───────────────────────────────────────────

describe('HexacoProfileSchemaV4 — lockstep with V3', () => {
  it('cold-start parses successfully under V4', () => {
    const parsed = HexacoProfileSchemaV4.safeParse(validHexacoColdStart);
    expect(parsed.success).toBe(true);
  });

  it('populated parses successfully under V4', () => {
    const parsed = HexacoProfileSchemaV4.safeParse(validHexacoPopulated);
    expect(parsed.success).toBe(true);
  });
});

// ── Schwartz v3 happy path ──────────────────────────────────────────────

describe('SchwartzProfileSchemaV3 — happy path', () => {
  it('cold-start (all 10 dims null) parses successfully', () => {
    const parsed = SchwartzProfileSchemaV3.safeParse(validSchwartzColdStart);
    expect(parsed.success).toBe(true);
  });

  it('populated (all 10 dims set) parses successfully', () => {
    const parsed = SchwartzProfileSchemaV3.safeParse(validSchwartzPopulated);
    expect(parsed.success).toBe(true);
  });
});

// ── Schwartz v3 boundary tests ──────────────────────────────────────────

describe('SchwartzProfileSchemaV3 — boundary tests', () => {
  it('score 1.0 accepted; 0.5 rejected', () => {
    const ok = { ...validSchwartzPopulated, universalism: makeDimensionFixture(1.0, 0.5, '2026-06-01T00:00:00.000Z') };
    const bad = { ...validSchwartzPopulated, universalism: makeDimensionFixture(0.5, 0.5, '2026-06-01T00:00:00.000Z') };
    expect(SchwartzProfileSchemaV3.safeParse(ok).success).toBe(true);
    expect(SchwartzProfileSchemaV3.safeParse(bad).success).toBe(false);
  });

  it('score 5.0 accepted; 5.5 rejected', () => {
    const ok = { ...validSchwartzPopulated, universalism: makeDimensionFixture(5.0, 0.5, '2026-06-01T00:00:00.000Z') };
    const bad = { ...validSchwartzPopulated, universalism: makeDimensionFixture(5.5, 0.5, '2026-06-01T00:00:00.000Z') };
    expect(SchwartzProfileSchemaV3.safeParse(ok).success).toBe(true);
    expect(SchwartzProfileSchemaV3.safeParse(bad).success).toBe(false);
  });

  it('confidence 0.0 / 1.0 accepted; -0.1 / 1.1 rejected', () => {
    const ok0 = { ...validSchwartzPopulated, universalism: makeDimensionFixture(3.0, 0.0, '2026-06-01T00:00:00.000Z') };
    const ok1 = { ...validSchwartzPopulated, universalism: makeDimensionFixture(3.0, 1.0, '2026-06-01T00:00:00.000Z') };
    const badL = { ...validSchwartzPopulated, universalism: makeDimensionFixture(3.0, -0.1, '2026-06-01T00:00:00.000Z') };
    const badH = { ...validSchwartzPopulated, universalism: makeDimensionFixture(3.0, 1.1, '2026-06-01T00:00:00.000Z') };
    expect(SchwartzProfileSchemaV3.safeParse(ok0).success).toBe(true);
    expect(SchwartzProfileSchemaV3.safeParse(ok1).success).toBe(true);
    expect(SchwartzProfileSchemaV3.safeParse(badL).success).toBe(false);
    expect(SchwartzProfileSchemaV3.safeParse(badH).success).toBe(false);
  });
});

// ── Schwartz v3 .strict() ───────────────────────────────────────────────

describe('SchwartzProfileSchemaV3 — .strict() rejects unknown keys', () => {
  it('unknown top-level key rejected', () => {
    const fixture = { ...validSchwartzPopulated, extra: 'wat' };
    expect(SchwartzProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });

  it('unknown per-dimension key rejected', () => {
    const fixture = {
      ...validSchwartzPopulated,
      universalism: { ...VALID_DIM, extra: 'wat' },
    };
    expect(SchwartzProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });
});

// ── Schwartz v4 lockstep ────────────────────────────────────────────────

describe('SchwartzProfileSchemaV4 — lockstep with V3', () => {
  it('cold-start parses successfully under V4', () => {
    expect(SchwartzProfileSchemaV4.safeParse(validSchwartzColdStart).success).toBe(true);
  });

  it('populated parses successfully under V4', () => {
    expect(SchwartzProfileSchemaV4.safeParse(validSchwartzPopulated).success).toBe(true);
  });
});

// ── Attachment v3 happy path ────────────────────────────────────────────

describe('AttachmentProfileSchemaV3 — happy path', () => {
  it('cold-start (all 3 dims null) parses successfully', () => {
    expect(AttachmentProfileSchemaV3.safeParse(validAttachmentColdStart).success).toBe(true);
  });

  it('populated (all 3 dims set) parses successfully', () => {
    expect(AttachmentProfileSchemaV3.safeParse(validAttachmentPopulated).success).toBe(true);
  });
});

// ── Attachment v3 boundary tests ────────────────────────────────────────

describe('AttachmentProfileSchemaV3 — boundary tests', () => {
  it('score 1.0 / 5.0 accepted; 0.5 / 5.5 rejected', () => {
    const lo = { ...validAttachmentPopulated, secure: makeDimensionFixture(1.0, 0.5, '2026-06-01T00:00:00.000Z') };
    const hi = { ...validAttachmentPopulated, secure: makeDimensionFixture(5.0, 0.5, '2026-06-01T00:00:00.000Z') };
    const badL = { ...validAttachmentPopulated, secure: makeDimensionFixture(0.5, 0.5, '2026-06-01T00:00:00.000Z') };
    const badH = { ...validAttachmentPopulated, secure: makeDimensionFixture(5.5, 0.5, '2026-06-01T00:00:00.000Z') };
    expect(AttachmentProfileSchemaV3.safeParse(lo).success).toBe(true);
    expect(AttachmentProfileSchemaV3.safeParse(hi).success).toBe(true);
    expect(AttachmentProfileSchemaV3.safeParse(badL).success).toBe(false);
    expect(AttachmentProfileSchemaV3.safeParse(badH).success).toBe(false);
  });

  it('confidence 0.0 / 1.0 accepted; -0.1 / 1.1 rejected', () => {
    const ok0 = { ...validAttachmentPopulated, secure: makeDimensionFixture(3.0, 0.0, '2026-06-01T00:00:00.000Z') };
    const ok1 = { ...validAttachmentPopulated, secure: makeDimensionFixture(3.0, 1.0, '2026-06-01T00:00:00.000Z') };
    const badL = { ...validAttachmentPopulated, secure: makeDimensionFixture(3.0, -0.1, '2026-06-01T00:00:00.000Z') };
    const badH = { ...validAttachmentPopulated, secure: makeDimensionFixture(3.0, 1.1, '2026-06-01T00:00:00.000Z') };
    expect(AttachmentProfileSchemaV3.safeParse(ok0).success).toBe(true);
    expect(AttachmentProfileSchemaV3.safeParse(ok1).success).toBe(true);
    expect(AttachmentProfileSchemaV3.safeParse(badL).success).toBe(false);
    expect(AttachmentProfileSchemaV3.safeParse(badH).success).toBe(false);
  });

  it('last_updated non-ISO string rejected', () => {
    const bad = { ...validAttachmentPopulated, secure: makeDimensionFixture(3.0, 0.5, 'not-iso') };
    expect(AttachmentProfileSchemaV3.safeParse(bad).success).toBe(false);
  });
});

// ── Attachment v3 .strict() ─────────────────────────────────────────────

describe('AttachmentProfileSchemaV3 — .strict() rejects unknown keys', () => {
  it('unknown top-level key rejected', () => {
    const fixture = { ...validAttachmentPopulated, extra: 'wat' };
    expect(AttachmentProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });

  it('unknown per-dimension key rejected', () => {
    const fixture = {
      ...validAttachmentPopulated,
      secure: { ...VALID_DIM, extra: 'wat' },
    };
    expect(AttachmentProfileSchemaV3.safeParse(fixture).success).toBe(false);
  });
});

// ── Attachment v4 lockstep ──────────────────────────────────────────────

describe('AttachmentProfileSchemaV4 — lockstep with V3', () => {
  it('cold-start parses successfully under V4', () => {
    expect(AttachmentProfileSchemaV4.safeParse(validAttachmentColdStart).success).toBe(true);
  });

  it('populated parses successfully under V4', () => {
    expect(AttachmentProfileSchemaV4.safeParse(validAttachmentPopulated).success).toBe(true);
  });
});
