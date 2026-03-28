import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB layer (K001 pattern) ───────────────────────────────────────────

const { mockSelect, mockInsert, mockDelete, mockFrom, mockWhere, mockLimit, mockValues, mockOnConflict, mockSet } = vi.hoisted(() => {
  const mockSet = vi.fn();
  const mockOnConflict = vi.fn().mockReturnValue({ set: mockSet });
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  const mockDelete = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  return { mockSelect, mockInsert, mockDelete, mockFrom, mockWhere, mockLimit, mockValues, mockOnConflict, mockSet };
});

vi.mock('../../db/connection.js', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  },
}));

// ── Import module under test AFTER mocks ───────────────────────────────────

import {
  getLastSent,
  setLastSent,
  hasSentToday,
  getMuteUntil,
  setMuteUntil,
  isMuted,
} from '../state.js';

describe('ProactiveState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default chain behavior
    mockLimit.mockResolvedValue([]);
    mockSet.mockResolvedValue(undefined);
    mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  // ── hasSentToday ───────────────────────────────────────────────────────

  describe('hasSentToday', () => {
    it('returns false when no last_sent exists', async () => {
      mockLimit.mockResolvedValueOnce([]);
      expect(await hasSentToday('Europe/Paris')).toBe(false);
    });

    it('returns true when last_sent is today in the given timezone', async () => {
      // Create a date that is "today" in Europe/Paris
      const now = new Date();
      mockLimit.mockResolvedValueOnce([{ value: now.toISOString() }]);
      expect(await hasSentToday('Europe/Paris')).toBe(true);
    });

    it('returns false when last_sent is yesterday (timezone boundary)', async () => {
      // Create a date that is clearly yesterday in Europe/Paris
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0); // noon yesterday — unambiguously yesterday in any TZ
      mockLimit.mockResolvedValueOnce([{ value: yesterday.toISOString() }]);
      expect(await hasSentToday('Europe/Paris')).toBe(false);
    });

    it('handles timezone-sensitive boundary correctly', async () => {
      // 2026-01-15 23:30 UTC = 2026-01-16 00:30 Europe/Paris
      // So in Paris it's "today" (Jan 16), but in UTC it's still Jan 15
      const utcLateNight = new Date('2026-01-15T23:30:00Z');

      // Mock "now" to be Jan 16 at 10:00 Paris time (09:00 UTC)
      const nowInParis = new Date('2026-01-16T09:00:00Z');
      vi.spyOn(Date, 'now').mockReturnValue(nowInParis.getTime());
      // Override Date constructor for `new Date()` in hasSentToday
      const OriginalDate = globalThis.Date;
      const MockDate = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(nowInParis.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
      } as typeof Date;
      MockDate.now = () => nowInParis.getTime();
      globalThis.Date = MockDate;

      mockLimit.mockResolvedValueOnce([{ value: utcLateNight.toISOString() }]);
      // In Europe/Paris: last_sent is Jan 16, today is Jan 16 → true
      expect(await hasSentToday('Europe/Paris')).toBe(true);

      globalThis.Date = OriginalDate;
      vi.restoreAllMocks();
    });
  });

  // ── isMuted ────────────────────────────────────────────────────────────

  describe('isMuted', () => {
    it('returns false when no mute_until exists', async () => {
      mockLimit.mockResolvedValueOnce([]);
      expect(await isMuted()).toBe(false);
    });

    it('returns true when mute_until is in the future', async () => {
      const future = new Date(Date.now() + 3600_000); // 1 hour from now
      mockLimit.mockResolvedValueOnce([{ value: future.toISOString() }]);
      expect(await isMuted()).toBe(true);
    });

    it('returns false when mute_until is in the past', async () => {
      const past = new Date(Date.now() - 3600_000); // 1 hour ago
      mockLimit.mockResolvedValueOnce([{ value: past.toISOString() }]);
      expect(await isMuted()).toBe(false);
    });
  });

  // ── setLastSent ────────────────────────────────────────────────────────

  describe('setLastSent', () => {
    it('calls upsert with correct key and ISO value', async () => {
      const timestamp = new Date('2026-03-15T10:00:00Z');
      await setLastSent(timestamp);

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'last_sent',
          value: '2026-03-15T10:00:00.000Z',
        }),
      );
      expect(mockOnConflict).toHaveBeenCalledWith(
        expect.objectContaining({ target: expect.anything() }),
      );
    });
  });

  // ── setMuteUntil ───────────────────────────────────────────────────────

  describe('setMuteUntil', () => {
    it('sets mute_until when given a date', async () => {
      const until = new Date('2026-04-01T00:00:00Z');
      await setMuteUntil(until);

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'mute_until',
          value: '2026-04-01T00:00:00.000Z',
        }),
      );
    });

    it('deletes mute_until when given null', async () => {
      await setMuteUntil(null);
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  // ── getLastSent ────────────────────────────────────────────────────────

  describe('getLastSent', () => {
    it('returns null when no record exists', async () => {
      mockLimit.mockResolvedValueOnce([]);
      expect(await getLastSent()).toBeNull();
    });

    it('returns a Date when record exists', async () => {
      const iso = '2026-03-15T10:00:00.000Z';
      mockLimit.mockResolvedValueOnce([{ value: iso }]);
      const result = await getLastSent();
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe(iso);
    });
  });

  // ── getMuteUntil ───────────────────────────────────────────────────────

  describe('getMuteUntil', () => {
    it('returns null when no record exists', async () => {
      mockLimit.mockResolvedValueOnce([]);
      expect(await getMuteUntil()).toBeNull();
    });

    it('returns a Date when record exists', async () => {
      const iso = '2026-04-01T00:00:00.000Z';
      mockLimit.mockResolvedValueOnce([{ value: iso }]);
      const result = await getMuteUntil();
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe(iso);
    });
  });
});
