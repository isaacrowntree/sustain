import type { InstrumentPack, Prerequisite } from '@sustain/pack-sdk';
import type { ProgressState } from './progress.js';

function met(state: ProgressState, pack: InstrumentPack, req: Prerequisite): boolean {
  switch (req.kind) {
    case 'metric': {
      const best = state.bests[req.metric];
      if (!best) return false;
      const def = pack.metrics.find((m) => m.id === req.metric);
      return def?.direction === 'lower' ? best.value <= req.gte : best.value >= req.gte;
    }
    case 'self-report':
      return state.selfReports[req.id] === true;
    case 'drill-completed':
      return (state.drillCompletions[req.drill] ?? 0) >= (req.times ?? 1);
  }
}

/** Drills whose prerequisites are demonstrated. Progression is the curriculum. */
export function unlockedDrills(pack: InstrumentPack, state: ProgressState): Set<string> {
  const unlocked = new Set<string>();
  for (const drill of pack.drills) {
    const reqs = drill.requires ?? [];
    if (reqs.every((r) => met(state, pack, r))) unlocked.add(drill.id);
  }
  return unlocked;
}

/** Self-report prompts currently gating locked drills — asked post-session. */
export function pendingSelfReports(pack: InstrumentPack, state: ProgressState): { id: string; prompt: string }[] {
  const prompts = new Map<string, string>();
  for (const drill of pack.drills) {
    for (const req of drill.requires ?? []) {
      if (req.kind === 'self-report' && !state.selfReports[req.id]) {
        prompts.set(req.id, req.prompt);
      }
    }
  }
  return [...prompts].map(([id, prompt]) => ({ id, prompt }));
}
