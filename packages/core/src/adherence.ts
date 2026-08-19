import type { InstrumentPack } from '@sustain/pack-sdk';
import { addDays, daysBetween, mondayOf, type ISODate } from './dates.js';
import type { ProgressState } from './progress.js';

export interface WeekSummary {
  /** Monday of the week. */
  weekStart: ISODate;
  /** 1-based program week, or null if outside the program. */
  programWeek: number | null;
  sessionsDone: number;
  target: number;
  isPerfect: boolean;
}

export interface AdherenceSummary {
  weeks: WeekSummary[];
  perfectWeeks: number;
  /** Perfect weeks in a row, counting back from the last complete week. */
  currentStreak: number;
  totalSessions: number;
  totalPlayMinutes: number;
}

/**
 * Adherence is counted in weeks, not days: a "perfect week" hits the pack's
 * sessions-per-week target. Rest days can never break anything, and a single
 * missed day leaves the week recoverable — the habit-formation literature
 * (Lally et al. 2010) found one missed day does not impair habit formation.
 */
export function adherence(pack: InstrumentPack, state: ProgressState, today: ISODate): AdherenceSummary {
  const target = pack.schedule.daysPerWeek;
  const start = state.startDate;
  const weeks: WeekSummary[] = [];
  const byWeek = new Map<string, number>();

  for (const s of state.sessions) {
    const wk = mondayOf(s.date);
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
  }

  const firstMonday = mondayOf(start);
  const lastMonday = mondayOf(today);
  for (let wk = firstMonday; wk <= lastMonday; wk = addDays(wk, 7)) {
    const offset = daysBetween(start, wk);
    const programWeek = offset >= 0 && offset / 7 < pack.schedule.totalWeeks ? offset / 7 + 1 : null;
    const sessionsDone = byWeek.get(wk) ?? 0;
    weeks.push({ weekStart: wk, programWeek, sessionsDone, target, isPerfect: sessionsDone >= target });
  }

  let currentStreak = 0;
  // The in-progress week only counts toward the streak once it is perfect.
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i]!;
    const inProgress = w.weekStart === lastMonday;
    if (w.isPerfect) currentStreak += 1;
    else if (!inProgress) break;
  }

  return {
    weeks,
    perfectWeeks: weeks.filter((w) => w.isPerfect).length,
    currentStreak,
    totalSessions: state.sessions.length,
    totalPlayMinutes: Math.round(state.sessions.reduce((s, r) => s + r.playSeconds, 0) / 60),
  };
}
