import type { InstrumentPack } from '@sustain/pack-sdk';
import {
  emptyProgress,
  isoDate,
  mondayOf,
  nextMonday,
  parseISO,
  type ISODate,
  type ProgressState,
  type ProgressStore,
} from '@sustain/core';

const KEY_PREFIX = 'sustain:v1:';

export class LocalStorageStore implements ProgressStore {
  constructor(private packId: string) {}

  load(): ProgressState | null {
    const raw = localStorage.getItem(KEY_PREFIX + this.packId);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ProgressState;
    } catch {
      return null;
    }
  }

  save(state: ProgressState): void {
    localStorage.setItem(KEY_PREFIX + this.packId, JSON.stringify(state));
  }
}

export function today(): ISODate {
  return isoDate(new Date());
}

/**
 * Programs anchor to Mondays. Starting on a practice day joins this week
 * (today becomes a week-1 practice day); starting on a scheduled rest day
 * begins next Monday.
 */
export function startDateFor(pack: InstrumentPack, todayIso: ISODate): ISODate {
  const dow = parseISO(todayIso).getDay(); // 0 = Sunday
  const weekday = dow === 0 ? 7 : dow;
  return weekday <= pack.schedule.daysPerWeek ? mondayOf(todayIso) : nextMonday(todayIso);
}

export function beginProgram(pack: InstrumentPack, store: ProgressStore): ProgressState {
  const state = emptyProgress(pack.id, startDateFor(pack, today()));
  store.save(state);
  return state;
}

/** Export progress as a downloadable JSON blob URL (data ownership). */
export function exportProgress(state: ProgressState): string {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  return URL.createObjectURL(blob);
}
