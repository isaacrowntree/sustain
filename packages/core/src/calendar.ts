import type { InstrumentPack, Phase } from '@sustain/pack-sdk';
import { daysBetween, type ISODate } from './dates.js';

export interface ProgramDay {
  date: ISODate;
  /** 0-based day since program start. */
  dayIndex: number;
  /** 1-based program week. */
  week: number;
  /** 1-based day within the week (1 = Monday). */
  weekday: number;
  isRestDay: boolean;
  /** Past the final week. */
  isComplete: boolean;
  phase: Phase | null;
  /** 0-based index of this practice day within its phase (rest days: -1). */
  phaseSessionIndex: number;
  isPhaseFirstSession: boolean;
  isBossSession: boolean;
}

export function phaseForWeek(pack: InstrumentPack, week: number): Phase | null {
  return pack.phases.find((p) => week >= p.weeks[0] && week <= p.weeks[1]) ?? null;
}

/**
 * Resolve a calendar date against the program. Programs start on a Monday;
 * the first `daysPerWeek` days of each week are practice days, the rest are
 * scheduled rest days — rest is part of the protocol, not a lapse.
 */
export function programDayFor(pack: InstrumentPack, startDate: ISODate, date: ISODate): ProgramDay {
  const dayIndex = daysBetween(startDate, date);
  const week = Math.floor(dayIndex / 7) + 1;
  const weekday = (dayIndex % 7) + 1;
  const { daysPerWeek, totalWeeks } = pack.schedule;
  const isComplete = week > totalWeeks;
  const isRestDay = weekday > daysPerWeek;
  const phase = isComplete || dayIndex < 0 ? null : phaseForWeek(pack, week);

  let phaseSessionIndex = -1;
  let isPhaseFirstSession = false;
  let isBossSession = false;

  if (phase && !isRestDay) {
    const weekInPhase = week - phase.weeks[0];
    phaseSessionIndex = weekInPhase * daysPerWeek + (weekday - 1);
    isPhaseFirstSession = phaseSessionIndex === 0;
    const phaseWeeks = phase.weeks[1] - phase.weeks[0] + 1;
    isBossSession = phaseSessionIndex === phaseWeeks * daysPerWeek - 1;
  }

  return {
    date,
    dayIndex,
    week,
    weekday,
    isRestDay,
    isComplete,
    phase,
    phaseSessionIndex,
    isPhaseFirstSession,
    isBossSession,
  };
}

/** Fraction 0-1 of how far through its phase this week sits (for ramps). */
export function phaseProgress(phase: Phase, week: number): number {
  const span = phase.weeks[1] - phase.weeks[0];
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (week - phase.weeks[0]) / span));
}
