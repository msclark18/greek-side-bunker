import { describe, it, expect } from 'vitest'
import { calcCourseHcp, calcStableford, toPM, pmCls, isSeasonActive, ini } from './golf.js'

const cfg = { useSlopeRating: true, handicapPct: 100, maxHandicap: null }
const cfgNoSlope = { useSlopeRating: false, handicapPct: 100, maxHandicap: null }
const cfg90pct = { useSlopeRating: true, handicapPct: 90, maxHandicap: null }
const cfgCapped = { useSlopeRating: true, handicapPct: 100, maxHandicap: 18 }

// ── calcCourseHcp ────────────────────────────────────────────
describe('calcCourseHcp', () => {
  it('calculates with slope rating', () => {
    // idx 10, slope 113 (scratch), rating = par → 10
    expect(calcCourseHcp(10, 113, 72, 72, cfg)).toBe(10)
  })

  it('calculates with slope above 113', () => {
    // idx 15, slope 130, par 72, rating 74 → 15*(130/113) + (74-72) = 17.26+2 = 19.26 → 19
    expect(calcCourseHcp(15, 130, 72, 74, cfg)).toBe(19)
  })

  it('ignores slope when useSlopeRating is false', () => {
    expect(calcCourseHcp(12, 130, 72, 74, cfgNoSlope)).toBe(12)
  })

  it('applies handicap percentage', () => {
    // idx 10, slope 113, 90% → 9
    expect(calcCourseHcp(10, 113, 72, 72, cfg90pct)).toBe(9)
  })

  it('caps at maxHandicap', () => {
    // idx 25 would calculate to 25+ but capped at 18
    expect(calcCourseHcp(25, 113, 72, 72, cfgCapped)).toBe(18)
  })

  it('handles zero handicap', () => {
    expect(calcCourseHcp(0, 113, 72, 72, cfg)).toBe(0)
  })

  it('handles null/undefined inputs safely', () => {
    expect(() => calcCourseHcp(null, null, null, null, cfg)).not.toThrow()
    expect(() => calcCourseHcp(undefined, undefined, undefined, undefined, {})).not.toThrow()
    expect(calcCourseHcp(null, 113, 72, 72, cfg)).toBe(0)
  })

  it('handles missing cfg safely', () => {
    expect(() => calcCourseHcp(10, 113, 72, 72, null)).not.toThrow()
    expect(() => calcCourseHcp(10, 113, 72, 72, undefined)).not.toThrow()
  })
})

// ── calcStableford ───────────────────────────────────────────
describe('calcStableford', () => {
  it('awards 2 points for net par', () => {
    // gross 82, hcp 10, par 72 → net 72 = par → 2 pts
    expect(calcStableford(82, 10, 72)).toBe(2)
  })

  it('awards 3 points for net birdie', () => {
    // gross 81, hcp 10, par 72 → net 71 = birdie → 3 pts
    expect(calcStableford(81, 10, 72)).toBe(3)
  })

  it('awards 4 points for net eagle', () => {
    expect(calcStableford(80, 10, 72)).toBe(4)
  })

  it('awards 1 point for net bogey', () => {
    expect(calcStableford(83, 10, 72)).toBe(1)
  })

  it('awards 0 points for net double bogey or worse', () => {
    expect(calcStableford(84, 10, 72)).toBe(0)
    expect(calcStableford(90, 10, 72)).toBe(0)
  })

  it('never returns negative points', () => {
    expect(calcStableford(120, 0, 72)).toBe(0)
  })

  it('handles null/undefined safely', () => {
    expect(() => calcStableford(null, null, null)).not.toThrow()
    expect(calcStableford(null, null, null)).toBeGreaterThanOrEqual(0)
  })
})

// ── toPM ────────────────────────────────────────────────────
describe('toPM', () => {
  it('returns E for even par', () => {
    expect(toPM(72, 72)).toBe('E')
  })

  it('returns +N for over par', () => {
    expect(toPM(75, 72)).toBe('+3')
  })

  it('returns -N for under par', () => {
    expect(toPM(69, 72)).toBe('-3')
  })

  it('handles nulls safely', () => {
    expect(() => toPM(null, null)).not.toThrow()
  })
})

// ── pmCls ────────────────────────────────────────────────────
describe('pmCls', () => {
  it('returns under for below par', () => {
    expect(pmCls(69, 72)).toBe('under')
  })

  it('returns over for above par', () => {
    expect(pmCls(75, 72)).toBe('over')
  })

  it('returns even for par', () => {
    expect(pmCls(72, 72)).toBe('even')
  })
})

// ── isSeasonActive ───────────────────────────────────────────
describe('isSeasonActive', () => {
  it('returns true when no dates set', () => {
    expect(isSeasonActive({})).toBe(true)
    expect(isSeasonActive({ seasonStart: null, seasonEnd: null })).toBe(true)
  })

  it('returns false when season has not started', () => {
    expect(isSeasonActive({ seasonStart: '2099-01-01', seasonEnd: null })).toBe(false)
  })

  it('returns false when season has ended', () => {
    expect(isSeasonActive({ seasonStart: null, seasonEnd: '2000-01-01' })).toBe(false)
  })

  it('returns true when within season', () => {
    expect(isSeasonActive({ seasonStart: '2000-01-01', seasonEnd: '2099-12-31' })).toBe(true)
  })

  it('handles null cfg safely', () => {
    expect(() => isSeasonActive(null)).not.toThrow()
    expect(isSeasonActive(null)).toBe(true)
  })
})

// ── ini ──────────────────────────────────────────────────────
describe('ini', () => {
  it('returns initials for full name', () => {
    expect(ini('Mason Clark')).toBe('MC')
  })

  it('returns single initial for one name', () => {
    expect(ini('Mason')).toBe('M')
  })

  it('returns max 2 chars', () => {
    expect(ini('John Paul Jones')).toBe('JP')
  })

  it('handles empty string', () => {
    expect(ini('')).toBe('?')
  })

  it('handles null/undefined safely', () => {
    expect(() => ini(null)).not.toThrow()
    expect(() => ini(undefined)).not.toThrow()
    expect(ini(null)).toBe('?')
    expect(ini(undefined)).toBe('?')
  })

  it('uppercases initials', () => {
    expect(ini('mason clark')).toBe('MC')
  })
})
