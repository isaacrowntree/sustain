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
import { idbGet, idbPut, PROGRESS_STORE } from './idb.js';

/**
 * Progress lives in IndexedDB — the browser's on-disk database — not
 * localStorage: no 5MB string ceiling, structured storage, and it
 * participates in persistent-storage protection.
 */
export class IndexedDBProgressStore implements ProgressStore {
  constructor(private packId: string) {}

  load(): Promise<ProgressState | null> {
    return idbGet<ProgressState>(PROGRESS_STORE, this.packId);
  }

  save(state: ProgressState): Promise<void> {
    return idbPut(PROGRESS_STORE, this.packId, state);
  }
}

export function today(): ISODate {
  return isoDate(new Date());
}

/**
 * Programs anchor to Mondays. Starting on a practice day joins this week
 * (the first week's adherence target is prorated to the days remaining);
 * starting on a scheduled rest day begins next Monday.
 */
export function startDateFor(pack: InstrumentPack, todayIso: ISODate): ISODate {
  const dow = parseISO(todayIso).getDay(); // 0 = Sunday
  const weekday = dow === 0 ? 7 : dow;
  return weekday <= pack.schedule.daysPerWeek ? mondayOf(todayIso) : nextMonday(todayIso);
}

export async function beginProgram(pack: InstrumentPack, store: ProgressStore): Promise<ProgressState> {
  const now = today();
  const state = emptyProgress(pack.id, startDateFor(pack, now), now);
  await store.save(state);
  // Ask the browser to shield this origin's data from storage eviction —
  // sixteen weeks of practice history should not vanish under disk pressure.
  void navigator.storage?.persist?.();
  return state;
}

/** Export progress as a downloadable JSON blob URL (data ownership). */
export function exportProgress(state: ProgressState): string {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  return URL.createObjectURL(blob);
}
