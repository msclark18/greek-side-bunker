import { describe, it, expect } from 'vitest'
import {
  distinctCoursesPlayed,
  netAverage,
  bestNetPerCourseAverage,
  standardPairs,
  buildCoursePlayoff,
  pairAdjacentWinners,
  qualificationStatus,
} from './playoffs.js'

const COURSES = [
  { id: 1, name: 'Bonneville' },
  { id: 2, name: 'Eaglewood' },
  { id: 3, name: 'Mountain Dell Canyon' },
  { id: 4, name: 'Old Mill' },
]

const roundsFor = (playerId, courseCount, net) =>
  Array.from({ length: courseCount }, (_, i) => ({
    player_id: playerId,
    course_id: i + 1,
    net,
  }))

describe('distinctCoursesPlayed', () => {
  it('counts unique regular-season courses', () => {
    const rounds = [
      { course_id: 1, net: 72 },
      { course_id: 1, net: 70 },
      { course_id: 3, net: 74 },
    ]
    expect(distinctCoursesPlayed(rounds, [1, 2, 3, 4])).toBe(2)
  })

  it('ignores playoff-only / unknown courses', () => {
    expect(distinctCoursesPlayed([{ course_id: 99, net: 70 }], [1, 2, 3, 4])).toBe(0)
  })
})

describe('netAverage', () => {
  it('averages net scores', () => {
    expect(netAverage([{ net: 70 }, { net: 74 }])).toBe(72)
  })

  it('returns null when empty', () => {
    expect(netAverage([])).toBe(null)
  })
})

describe('bestNetPerCourseAverage', () => {
  it('takes the better net when a course is played twice', () => {
    const rounds = [
      { course_id: 1, net: 70 },
      { course_id: 1, net: 78 },
    ]
    expect(bestNetPerCourseAverage(rounds, [1, 2, 3, 4])).toBe(70)
    expect(netAverage(rounds)).toBe(74)
  })

  it('averages course-bests across four courses with one extra round', () => {
    const rounds = [
      { course_id: 1, net: 70 },
      { course_id: 1, net: 78 },
      { course_id: 2, net: 74 },
      { course_id: 3, net: 72 },
      { course_id: 4, net: 76 },
    ]
    expect(bestNetPerCourseAverage(rounds, [1, 2, 3, 4])).toBe(73)
    expect(netAverage(rounds)).toBe(74)
  })

  it('ignores playoff-only / unknown courses', () => {
    expect(bestNetPerCourseAverage([{ course_id: 99, net: 60 }, { course_id: 1, net: 70 }], [1, 2, 3, 4])).toBe(70)
  })
})

describe('qualificationStatus', () => {
  it('marks 4/4 as bye priority', () => {
    expect(qualificationStatus(4, 4)).toBe('byePriority')
  })
  it('marks 3/4 as qualified', () => {
    expect(qualificationStatus(3, 4)).toBe('qualified')
  })
  it('marks 2/4 as qualified with no bye', () => {
    expect(qualificationStatus(2, 4)).toBe('qualifiedNoBye')
  })
  it('marks 1/4 as not qualified', () => {
    expect(qualificationStatus(1, 4)).toBe('notQualified')
  })
})

describe('standardPairs', () => {
  it('pairs an 8-player bracket', () => {
    expect(standardPairs(8)).toEqual([[1, 8], [5, 4], [3, 6], [7, 2]])
  })
})

const emailField = () => {
  const roster = [
    { id: '1', name: 'Anthony Limantzakis', courses: 4, net: 70 },
    { id: '2', name: 'Zach Howlett', courses: 4, net: 71 },
    { id: '3', name: 'Ross Roudopoulos', courses: 3, net: 72 },
    { id: '4', name: 'Chris Tsoutsounakis', courses: 4, net: 73 },
    { id: '5', name: 'Alexander Priskos', courses: 4, net: 74 },
    { id: '6', name: 'Christian Priskos', courses: 4, net: 75 },
    { id: '7', name: 'Zach Coombs', courses: 2, net: 76 },
    { id: '8', name: 'Mason Clark', courses: 4, net: 77 },
    { id: '9', name: 'Nico Priskos', courses: 2, net: 78 },
    { id: '10', name: 'Nick Katsanevas', courses: 2, net: 79 },
    { id: '11', name: 'Yiorgos', courses: 2, net: 80 },
    { id: '12', name: 'Chris Metos', courses: 3, net: 81 },
    { id: '13', name: 'Tyson LaSpina', courses: 3, net: 82 },
    { id: '14', name: 'Pete Saltas', courses: 2, net: 83 },
  ]
  const players = roster.map(({ id, name }) => ({ id, name }))
  const roundsByPlayer = Object.fromEntries(
    roster.map(p => [p.id, roundsFor(p.id, p.courses, p.net)])
  )
  return buildCoursePlayoff({ players, roundsByPlayer, regularCourses: COURSES })
}

describe('buildCoursePlayoff — email 14-player field', () => {
  it('seeds 14 eligible players, last by net among the rest', () => {
    const field = emailField()
    expect(field.fieldSize).toBe(14)
    expect(field.seeds[0].name).toBe('Anthony Limantzakis')
    expect(field.seeds[1].name).toBe('Zach Howlett')
    expect(field.seeds[13].name).toBe('Pete Saltas')
  })

  it('keeps 4-course players in seeds 1–4; 3-course is no higher than 5', () => {
    const field = emailField()
    expect(field.seeds.slice(0, 4).map(p => p.name)).toEqual([
      'Anthony Limantzakis',
      'Zach Howlett',
      'Chris Tsoutsounakis',
      'Alexander Priskos',
    ])
    expect(field.seeds.slice(0, 4).every(p => p.coursesPlayed === 4)).toBe(true)
    const ross = field.seeds.find(p => p.name === 'Ross Roudopoulos')
    expect(ross.seed).toBe(5)
    expect(ross.coursesPlayed).toBe(3)
  })

  it('gives Round 1 byes to seeds 1 and 2 when they are 4/4', () => {
    const field = emailField()
    expect(field.byeRecipients).toEqual(['Anthony Limantzakis', 'Zach Howlett'])
    expect(field.seeds.filter(p => p.hasBye).map(p => p.seed)).toEqual([1, 2])
  })

  it('pairs remaining high vs low: 3 vs 14, 4 vs 13', () => {
    const field = emailField()
    const playIn = field.round1Matchups.filter(m => !m.isBye)
    expect(playIn).toHaveLength(6)
    expect(playIn.find(m => m.seed1 === 3 || m.seed2 === 3)).toMatchObject({ p1: 'Chris Tsoutsounakis', p2: 'Pete Saltas', seed1: 3, seed2: 14 })
    expect(playIn.find(m => m.seed1 === 4 || m.seed2 === 4)).toMatchObject({ p1: 'Alexander Priskos', p2: 'Tyson LaSpina', seed1: 4, seed2: 13 })
    expect(playIn.find(m => m.seed1 === 8 || m.seed2 === 8)).toMatchObject({ p1: 'Mason Clark', p2: 'Nico Priskos', seed1: 8, seed2: 9 })
  })

  it('uses a 16-player bracket (2 byes) for a 14-player field', () => {
    const field = emailField()
    expect(field.bracketSize).toBe(16)
    expect(field.byeRecipients).toHaveLength(2)
  })

  it('keeps byes in Round 1 so the tree stays a power of two', () => {
    const field = emailField()
    expect(field.round1Matchups).toHaveLength(8)
    expect(field.round1Matchups.filter(m => m.isBye)).toHaveLength(2)
    expect(field.round1Matchups[0]).toMatchObject({ isBye: true, seed1: 1, p2: null, winner: 'Anthony Limantzakis' })
  })

  it('does not qualify a 1-course player', () => {
    const field = emailField()
    const extra = buildCoursePlayoff({
      players: [...field.seeds, { id: '99', name: 'One Course' }],
      roundsByPlayer: {
        ...Object.fromEntries(field.seeds.map(p => [p.id, roundsFor(p.id, p.coursesPlayed, p.netAvg)])),
        '99': roundsFor('99', 1, 60),
      },
      regularCourses: COURSES,
    })
    expect(extra.seeds.find(p => p.id === '99')).toBeUndefined()
    expect(extra.ineligible.some(p => p.id === '99')).toBe(true)
  })
})

describe('buildCoursePlayoff — 2-course top seed cannot get a bye', () => {
  it('gives byes to 4/4 players and keeps the 2-course ace at seed 5', () => {
    const roster = [
      { id: '1', name: 'Two Course Ace', courses: 2, net: 68 },
      { id: '2', name: 'Full A', courses: 4, net: 70 },
      { id: '3', name: 'Full B', courses: 4, net: 71 },
      { id: '4', name: 'Full C', courses: 4, net: 72 },
      { id: '5', name: 'Three A', courses: 3, net: 73 },
      { id: '6', name: 'Two B', courses: 2, net: 74 },
      { id: '7', name: 'Two C', courses: 2, net: 75 },
      { id: '8', name: 'Two D', courses: 2, net: 76 },
      { id: '9', name: 'Two E', courses: 2, net: 77 },
      { id: '10', name: 'Two F', courses: 2, net: 78 },
      { id: '11', name: 'Two G', courses: 2, net: 79 },
      { id: '12', name: 'Two H', courses: 2, net: 80 },
      { id: '13', name: 'Two I', courses: 2, net: 81 },
      { id: '14', name: 'Two J', courses: 2, net: 82 },
    ]
    const result = buildCoursePlayoff({
      players: roster.map(({ id, name }) => ({ id, name })),
      roundsByPlayer: Object.fromEntries(roster.map(p => [p.id, roundsFor(p.id, p.courses, p.net)])),
      regularCourses: COURSES,
    })
    expect(result.seeds.slice(0, 4).map(p => p.name)).toEqual(['Full A', 'Full B', 'Full C', 'Three A'])
    expect(result.byeRecipients).toEqual(['Full A', 'Full B'])
    const ace = result.seeds.find(p => p.name === 'Two Course Ace')
    expect(ace.seed).toBe(5)
    expect(ace.hasBye).toBe(false)
  })
})

describe('buildCoursePlayoff — leftover top seeds fill with 3-course', () => {
  it('puts 3-course players in seeds 3–4 when only two players finished all courses', () => {
    const roster = [
      { id: '1', name: 'Full A', courses: 4, net: 74 },
      { id: '2', name: 'Full B', courses: 4, net: 75 },
      { id: '3', name: 'Hot Three', courses: 3, net: 68 },
      { id: '4', name: 'Warm Three', courses: 3, net: 69 },
      { id: '5', name: 'Two Ace', courses: 2, net: 60 },
      { id: '6', name: 'Two B', courses: 2, net: 76 },
      { id: '7', name: 'Two C', courses: 2, net: 77 },
      { id: '8', name: 'Two D', courses: 2, net: 78 },
      { id: '9', name: 'Two E', courses: 2, net: 79 },
      { id: '10', name: 'Two F', courses: 2, net: 80 },
      { id: '11', name: 'Two G', courses: 2, net: 81 },
      { id: '12', name: 'Two H', courses: 2, net: 82 },
    ]
    const result = buildCoursePlayoff({
      players: roster.map(({ id, name }) => ({ id, name })),
      roundsByPlayer: Object.fromEntries(roster.map(p => [p.id, roundsFor(p.id, p.courses, p.net)])),
      regularCourses: COURSES,
    })
    expect(result.seeds.slice(0, 4).map(p => p.name)).toEqual(['Full A', 'Full B', 'Hot Three', 'Warm Three'])
    expect(result.seeds.find(p => p.name === 'Two Ace').seed).toBe(5)
  })
})

describe('buildCoursePlayoff — best per course seeding', () => {
  it('does not let a worse second round at the same course drop the seed', () => {
    const players = [
      { id: 'a', name: 'Ace' },
      { id: 'b', name: 'Even' },
    ]
    const roundsByPlayer = {
      a: [
        { course_id: 1, net: 70 },
        { course_id: 1, net: 90 },
        { course_id: 2, net: 70 },
      ],
      b: [
        { course_id: 1, net: 72 },
        { course_id: 2, net: 72 },
      ],
    }
    const allRounds = buildCoursePlayoff({ players, roundsByPlayer, regularCourses: COURSES })
    expect(allRounds.seeds[0].name).toBe('Even')
    const best = buildCoursePlayoff({ players, roundsByPlayer, regularCourses: COURSES, seedBestPerCourse: true })
    expect(best.seeds[0].name).toBe('Ace')
    expect(best.seeds[0].netAvg).toBe(70)
  })
})

describe('pairAdjacentWinners', () => {
  it('feeds quarterfinals from adjacent Round 1 slots, not a re-seed of remaining seeds', () => {
    const field = emailField()
    const r1 = field.round1Matchups.map(m => ({
      ...m,
      winner: m.seed1 === 3 ? m.p2 : m.p1,
    }))
    const qf = pairAdjacentWinners(r1)
    expect(qf).toHaveLength(r1.length / 2)
    const upsetWinner = r1.find(m => m.seed1 === 3).p2
    expect(qf.some(m => m.p1 === 'Anthony Limantzakis' && m.p2 === upsetWinner)).toBe(false)
    expect(qf[0].p1).toBe(r1[0].winner)
    expect(qf[0].p2).toBe(r1[1].winner)
  })
})
