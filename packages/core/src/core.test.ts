import { describe, expect, it } from 'vitest';
import { didgeridooPack as pack } from '@sustain/pack-didgeridoo';
import { programDayFor } from './calendar.js';
import { compileSession } from './compiler.js';
import {
  completedDrillSet,
  drillsDoneOn,
  emptyProgress,
  pendingFirstSessionDrills,
  recordDrillCompletion,
  recordMetric,
  recordSession,
} from './progress.js';
import { unlockedDrills } from './unlocks.js';
import { adherence } from './adherence.js';
import { addDays } from './dates.js';

const START = '2026-08-24'; // a Monday

describe('calendar', () => {
  it('marks the first daysPerWeek days as practice, the rest as rest', () => {
    const mon = programDayFor(pack, START, START);
    expect(mon.isRestDay).toBe(false);
    expect(mon.week).toBe(1);
    const sat = programDayFor(pack, START, addDays(START, 5));
    expect(sat.isRestDay).toBe(true);
  });

  it('finds phase boundaries and boss sessions', () => {
    const day1 = programDayFor(pack, START, START);
    expect(day1.phase?.id).toBe('foundation');
    expect(day1.isPhaseFirstSession).toBe(true);
    // Last practice day of week 2 = foundation boss.
    const bossDay = programDayFor(pack, START, addDays(START, 7 + pack.schedule.daysPerWeek - 1));
    expect(bossDay.isBossSession).toBe(true);
    // Week 17 is past the program.
    const after = programDayFor(pack, START, addDays(START, 16 * 7));
    expect(after.isComplete).toBe(true);
  });
});

describe('compiler', () => {
  it('compiles a first session with the baseline recording prepended', () => {
    const state = emptyProgress(pack.id, START);
    const day = programDayFor(pack, START, START);
    const session = compileSession(pack, day, unlockedDrills(pack, state));
    expect(session).not.toBeNull();
    expect(session!.segments[0]!.drillId).toBe('baseline-recording');
    expect(session!.segments.some((s) => s.kind === 'record')).toBe(true);
  });

  it('prepends first-session drills for a mid-week joiner via the override', () => {
    const state = emptyProgress(pack.id, START);
    // Wednesday of week 1: not the calendar-first session of the phase.
    const day = programDayFor(pack, START, addDays(START, 2));
    expect(day.isPhaseFirstSession).toBe(false);
    const plain = compileSession(pack, day, unlockedDrills(pack, state))!;
    expect(plain.segments[0]!.drillId).not.toBe('baseline-recording');
    const withOverride = compileSession(pack, day, unlockedDrills(pack, state), {
      firstSessionOfPhase: true,
    })!;
    expect(withOverride.segments[0]!.drillId).toBe('baseline-recording');
  });

  it('keeps offering a one-off drill until it has actually been completed', () => {
    const state = emptyProgress(pack.id, START);
    const day = programDayFor(pack, START, addDays(START, 2));
    const unlocked = unlockedDrills(pack, state);

    // Outstanding: the baseline recording still leads the session.
    expect(pendingFirstSessionDrills(state, pack.phases[0]!)).toContain('baseline-recording');
    const first = compileSession(pack, day, unlocked, { firstSessionOfPhase: true })!;
    expect(first.segments[0]!.drillId).toBe('baseline-recording');

    // Once genuinely done it drops off, even if asked for again.
    recordDrillCompletion(state, 'baseline-recording');
    expect(pendingFirstSessionDrills(state, pack.phases[0]!)).toHaveLength(0);
    const after = compileSession(pack, day, unlocked, {
      firstSessionOfPhase: true,
      completedDrills: completedDrillSet(state),
    })!;
    expect(after.segments.some((s) => s.drillId === 'baseline-recording')).toBe(false);
  });

  it('ramps session length across a phase', () => {
    const state = emptyProgress(pack.id, START);
    const unlocked = unlockedDrills(pack, state);
    const early = compileSession(pack, programDayFor(pack, START, addDays(START, 1)), unlocked)!;
    // Same weekday in week 2 (still foundation, further along the ramp).
    const late = compileSession(pack, programDayFor(pack, START, addDays(START, 8)), unlocked)!;
    expect(late.totalSeconds).toBeGreaterThan(early.totalSeconds);
  });

  it('returns null on rest days unless compiling a make-up session', () => {
    const state = emptyProgress(pack.id, START);
    const sat = programDayFor(pack, START, addDays(START, 5));
    expect(compileSession(pack, sat, unlockedDrills(pack, state))).toBeNull();
    const makeup = compileSession(pack, sat, unlockedDrills(pack, state), { makeup: true });
    expect(makeup).not.toBeNull();
    expect(makeup!.isBoss).toBe(false);
  });

  it('serves the nearest unlocked prerequisite when a whole pool is locked', () => {
    const state = emptyProgress(pack.id, START);
    // Week 6 (connection phase) with nothing demonstrated: cb-on-didge and
    // bridge-the-gap are locked; the chain bottoms out at cheek-puff-breathing.
    const day = programDayFor(pack, START, addDays(START, 5 * 7));
    expect(day.phase?.id).toBe('connection');
    const session = compileSession(pack, day, unlockedDrills(pack, state))!;
    const skillDrills = session.segments.filter((s) => s.role === 'skill').map((s) => s.drillId);
    expect(skillDrills).not.toContain('cb-on-didge');
    expect(skillDrills).not.toContain('bridge-the-gap');
    expect(skillDrills).toContain('cheek-puff-breathing');
  });

  it('appends measured assessments on boss sessions', () => {
    const state = emptyProgress(pack.id, START);
    const bossDay = programDayFor(pack, START, addDays(START, 7 + pack.schedule.daysPerWeek - 1));
    const session = compileSession(pack, bossDay, unlockedDrills(pack, state))!;
    expect(session.isBoss).toBe(true);
    expect(session.segments.some((s) => s.assessment && s.metric === 'longest-drone')).toBe(true);
  });
});

describe('unlocks', () => {
  it('gates the circular-breathing ladder until demonstrated', () => {
    const state = emptyProgress(pack.id, START);
    let unlocked = unlockedDrills(pack, state);
    expect(unlocked.has('first-drone')).toBe(true);
    expect(unlocked.has('water-spray')).toBe(false);
    expect(unlocked.has('cb-on-didge')).toBe(false);

    for (let i = 0; i < 3; i++) recordDrillCompletion(state, 'cheek-puff-breathing');
    unlocked = unlockedDrills(pack, state);
    expect(unlocked.has('water-spray')).toBe(true);

    for (let i = 0; i < 3; i++) recordDrillCompletion(state, 'straw-glass');
    state.selfReports['can-squeeze-sniff'] = true;
    unlocked = unlockedDrills(pack, state);
    expect(unlocked.has('cb-on-didge')).toBe(true);
  });

  it('gates unbroken-sets on a 60s measured run', () => {
    const state = emptyProgress(pack.id, START);
    expect(unlockedDrills(pack, state).has('unbroken-sets')).toBe(false);
    recordMetric(state, pack, 'longest-unbroken', 75, START, false);
    expect(unlockedDrills(pack, state).has('unbroken-sets')).toBe(true);
  });
});

describe('progress + adherence', () => {
  it('tracks personal records directionally', () => {
    const state = emptyProgress(pack.id, START);
    expect(recordMetric(state, pack, 'longest-drone', 12, START, false).isPersonalRecord).toBe(true);
    expect(recordMetric(state, pack, 'longest-drone', 10, START, false).isPersonalRecord).toBe(false);
    const pr = recordMetric(state, pack, 'longest-drone', 20, START, true);
    expect(pr.isPersonalRecord).toBe(true);
    expect(pr.previousBest).toBe(12);
  });

  it('prorates the join week so a mid-week joiner can still be perfect', () => {
    // Joined Wednesday: only Wed/Thu/Fri remain, so the target is 3.
    const join = addDays(START, 2);
    const state = emptyProgress(pack.id, START, join);
    for (let i = 2; i < 5; i++) {
      recordSession(state, {
        date: addDays(START, i),
        dayIndex: i,
        completedSeconds: 900,
        playSeconds: 600,
        verified: false,
        isBoss: false,
      });
    }
    const a = adherence(pack, state, addDays(START, 6));
    expect(a.weeks[0]!.target).toBe(3);
    expect(a.weeks[0]!.isPerfect).toBe(true);
    expect(a.currentStreak).toBe(1);
  });

  it('lets a rest-day make-up session recover a missed weekday', () => {
    const state = emptyProgress(pack.id, START);
    // Mon-Thu done, Friday missed, Saturday make-up.
    for (const i of [0, 1, 2, 3, 5]) {
      recordSession(state, {
        date: addDays(START, i),
        dayIndex: i,
        completedSeconds: 900,
        playSeconds: 600,
        verified: false,
        isBoss: false,
      });
    }
    const a = adherence(pack, state, addDays(START, 6));
    expect(a.weeks[0]!.isPerfect).toBe(true);
  });

  it('counts perfect weeks and streaks with rest days never breaking', () => {
    const state = emptyProgress(pack.id, START);
    // Complete all 5 practice days of week 1.
    for (let i = 0; i < 5; i++) {
      recordSession(state, {
        date: addDays(START, i),
        dayIndex: i,
        completedSeconds: 900,
        playSeconds: 600,
        verified: false,
        isBoss: false,
      });
    }
    // Ask on Sunday of week 1 — rest days at the end must not break anything.
    const sunday = addDays(START, 6);
    const a = adherence(pack, state, sunday);
    expect(a.perfectWeeks).toBe(1);
    expect(a.currentStreak).toBe(1);
    expect(a.totalSessions).toBe(5);
  });

  it('accumulates a day practised in several sittings into one record', () => {
    const state = emptyProgress(pack.id, START);
    recordSession(state, {
      date: START, dayIndex: 0, completedSeconds: 300, playSeconds: 200,
      verified: false, isBoss: false, counted: false, completedDrillIds: ['lip-flutter'],
    });
    recordSession(state, {
      date: START, dayIndex: 0, completedSeconds: 900, playSeconds: 700,
      verified: true, isBoss: false, counted: true, completedDrillIds: ['drone-holds', 'lip-flutter'],
    });

    expect(state.sessions).toHaveLength(1);
    const rec = state.sessions[0]!;
    expect(rec.completedSeconds).toBe(1200);
    expect(rec.playSeconds).toBe(900);
    expect(rec.verified).toBe(true);
    expect(rec.counted).toBe(true);
    expect(new Set(rec.completedDrillIds)).toEqual(new Set(['lip-flutter', 'drone-holds']));
    expect(drillsDoneOn(state, START).has('drone-holds')).toBe(true);
  });

  it('leaves an abandoned day out of the week until enough of it is done', () => {
    const state = emptyProgress(pack.id, START);
    recordSession(state, {
      date: START, dayIndex: 0, completedSeconds: 120, playSeconds: 60,
      verified: false, isBoss: false, counted: false,
    });
    expect(adherence(pack, state, START).totalSessions).toBe(1);
    expect(adherence(pack, state, START).weeks[0]!.sessionsDone).toBe(0);

    // Coming back later and finishing the work makes the day count.
    recordSession(state, {
      date: START, dayIndex: 0, completedSeconds: 900, playSeconds: 700,
      verified: false, isBoss: false, counted: true,
    });
    expect(adherence(pack, state, START).weeks[0]!.sessionsDone).toBe(1);
  });
});
