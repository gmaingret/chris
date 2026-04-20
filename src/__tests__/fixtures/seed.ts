/**
 * src/__tests__/fixtures/seed.ts — Phase 24 Plan 01
 *
 * Deterministic seeded RNG (Mulberry32) + Fisher-Yates shuffle.
 *
 * Shared by Plan 24-02 (Haiku few-shot selection) and Plan 24-03 (any
 * downstream deterministic sampling). Mulberry32 is a public-domain 32-bit
 * seeded PRNG (Tommy Ettinger / Boyer); deterministic across Node versions
 * because it uses only 32-bit unsigned integer arithmetic.
 *
 * Zero new npm deps — per D-RESEARCH recommendation (hand-roll, ~15 lines).
 */
export function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed >>> 0);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i]!, out[j]!] = [out[j]!, out[i]!];
  }
  return out;
}

export function seededSample<T>(arr: readonly T[], n: number, seed: number): T[] {
  return seededShuffle(arr, seed).slice(0, n);
}
