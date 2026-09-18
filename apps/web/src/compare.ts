/**
 * Day one against the summit. The pack names two recording drills — one
 * prepended to the first session of the first phase, one appended to the
 * final assessment — and the recording store keys captures as
 * `${packId}:${date}:${drillId}`. This module only decides which keys are
 * the "before" and the "after"; playback lives in the UI.
 */

import type { Drill, InstrumentPack } from '@sustain/pack-sdk';

export interface RecordingRef {
  key: string;
  date: string;
  drill: Drill;
}

export interface Comparison {
  baselineDrill: Drill | null;
  summitDrill: Drill | null;
  /** The earliest day-one capture, or null if it hasn't been recorded. */
  baseline: RecordingRef | null;
  /** The latest summit capture, or null if it hasn't been recorded. */
  summit: RecordingRef | null;
}

function isRecordingDrill(drill: Drill | undefined): drill is Drill {
  return Boolean(drill && drill.steps.some((s) => s.kind === 'record'));
}

/** The recording drill run once at the very start of the programme. */
export function baselineDrillFor(pack: InstrumentPack): Drill | null {
  const first = pack.phases[0];
  for (const id of first?.firstSessionDrills ?? []) {
    const drill = pack.drills.find((d) => d.id === id);
    if (isRecordingDrill(drill)) return drill;
  }
  return null;
}

/** The recording drill appended to the final phase's assessment. */
export function summitDrillFor(pack: InstrumentPack): Drill | null {
  const last = pack.phases[pack.phases.length - 1];
  for (const id of last?.bossAssessment?.drills ?? []) {
    const drill = pack.drills.find((d) => d.id === id);
    if (isRecordingDrill(drill)) return drill;
  }
  return null;
}

/** Parse a recording-store key back into its parts, or null if it isn't one. */
export function parseRecordingKey(key: string, packId: string): { date: string; drillId: string } | null {
  if (!key.startsWith(`${packId}:`)) return null;
  const rest = key.slice(packId.length + 1);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  const date = rest.slice(0, sep);
  const drillId = rest.slice(sep + 1);
  if (!drillId) return null;
  return { date, drillId };
}

/**
 * Pick the before and the after from whatever keys are in the store.
 * A drill practised again produces a second key with a later date: the
 * baseline keeps the earliest (that is what day one means) and the summit
 * keeps the latest (your best, most recent picture).
 */
export function selectComparison(pack: InstrumentPack, keys: readonly string[]): Comparison {
  const baselineDrill = baselineDrillFor(pack);
  const summitDrill = summitDrillFor(pack);

  const pick = (drill: Drill | null, choose: 'earliest' | 'latest'): RecordingRef | null => {
    if (!drill) return null;
    const matches = keys
      .map((key) => ({ key, parsed: parseRecordingKey(key, pack.id) }))
      .filter((m): m is { key: string; parsed: { date: string; drillId: string } } =>
        m.parsed !== null && m.parsed.drillId === drill.id,
      )
      .sort((a, b) => a.parsed.date.localeCompare(b.parsed.date));
    const hit = choose === 'earliest' ? matches[0] : matches[matches.length - 1];
    return hit ? { key: hit.key, date: hit.parsed.date, drill } : null;
  };

  return {
    baselineDrill,
    summitDrill,
    baseline: pick(baselineDrill, 'earliest'),
    summit: pick(summitDrill, 'latest'),
  };
}
