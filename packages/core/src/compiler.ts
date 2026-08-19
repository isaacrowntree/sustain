import type { Drill, InstrumentPack, SessionSlot } from '@sustain/pack-sdk';
import { phaseProgress, type ProgramDay } from './calendar.js';

export interface Segment {
  drillId: string;
  drillName: string;
  role: SessionSlot['role'] | 'assessment';
  kind: 'play' | 'rest' | 'instruction' | 'record';
  seconds: number;
  cue: string;
  detail?: string;
  metric?: string;
  /** True when this play segment is a measured boss attempt. */
  assessment?: boolean;
}

export interface CompiledSession {
  title: string;
  phaseId: string;
  phaseName: string;
  isBoss: boolean;
  segments: Segment[];
  totalSeconds: number;
  playSeconds: number;
}

function slotMinutes(slot: SessionSlot, t: number): number {
  if (typeof slot.minutes === 'number') return slot.minutes;
  return slot.minutes.start + (slot.minutes.end - slot.minutes.start) * t;
}

/** Deterministically rotate a drill pool by day, honoring unlocks. */
function pickDrill(pool: string[], unlocked: Set<string>, drillsById: Map<string, Drill>, dayIndex: number): Drill | null {
  const available = pool.filter((id) => unlocked.has(id) && drillsById.has(id));
  if (available.length === 0) {
    // Fall back to the first pool drill that exists at all, so a session can
    // always be compiled even if unlock state is missing.
    const fallback = pool.find((id) => drillsById.has(id));
    return fallback ? drillsById.get(fallback)! : null;
  }
  return drillsById.get(available[dayIndex % available.length]!)!;
}

function appendDrill(segments: Segment[], drill: Drill, role: Segment['role'], budgetSeconds: number): number {
  let used = 0;
  let passes = 0;
  // Loop the drill's step cycle to fill the slot budget; always complete at
  // least one full pass so short budgets still get a coherent drill.
  while (passes === 0 || used < budgetSeconds) {
    for (const step of drill.steps) {
      // Instruction/record steps only run on the first pass.
      if (passes > 0 && (step.kind === 'instruction' || step.kind === 'record')) continue;
      segments.push({
        drillId: drill.id,
        drillName: drill.name,
        role,
        kind: step.kind,
        seconds: step.seconds,
        cue: step.cue,
        detail: step.detail,
        metric: step.metric,
      });
      used += step.seconds;
    }
    passes += 1;
    if (used >= budgetSeconds && passes >= 1) break;
    // Safety valve against zero-length or pathological drills.
    if (passes > 50) break;
  }
  return used;
}

export interface CompileOptions {
  /**
   * Whether this is the player's actual first session of the phase (drives
   * one-off firstSessionDrills). Defaults to the calendar's notion; pass the
   * state-aware answer so a mid-week joiner still gets their day-one drills.
   */
  firstSessionOfPhase?: boolean;
}

/**
 * Compile one day's session: for each slot in the phase's plan, pick a drill
 * (rotating through unlocked pool members by day) and loop it to fill the
 * slot's time budget. First sessions of a phase prepend the phase's one-off
 * drills; boss sessions append measured assessment attempts.
 */
export function compileSession(
  pack: InstrumentPack,
  day: ProgramDay,
  unlockedDrillIds: Set<string>,
  options: CompileOptions = {},
): CompiledSession | null {
  const phase = day.phase;
  if (!phase || day.isRestDay || day.isComplete) return null;

  const drillsById = new Map(pack.drills.map((d) => [d.id, d]));
  const t = phaseProgress(phase, day.week);
  const segments: Segment[] = [];

  if (options.firstSessionOfPhase ?? day.isPhaseFirstSession) {
    for (const id of phase.firstSessionDrills ?? []) {
      const drill = drillsById.get(id);
      if (drill) appendDrill(segments, drill, 'skill', 0);
    }
  }

  for (const slot of phase.sessionPlan) {
    const drill = pickDrill(slot.drills, unlockedDrillIds, drillsById, day.dayIndex);
    if (!drill) continue;
    appendDrill(segments, drill, slot.role, slotMinutes(slot, t) * 60);
  }

  const boss = day.isBossSession ? phase.bossAssessment : undefined;
  if (boss) {
    const metricsById = new Map(pack.metrics.map((m) => [m.id, m]));
    for (const metricId of boss.metrics) {
      const metric = metricsById.get(metricId);
      segments.push({
        drillId: `boss-${metricId}`,
        drillName: boss.name,
        role: 'assessment',
        kind: 'play',
        seconds: 120,
        cue: `Assessment: ${metric?.name ?? metricId}. Give it everything.`,
        detail: boss.description,
        metric: metricId,
        assessment: true,
      });
      segments.push({
        drillId: `boss-${metricId}-rest`,
        drillName: boss.name,
        role: 'assessment',
        kind: 'rest',
        seconds: 45,
        cue: 'Recover fully before the next attempt.',
      });
    }
    for (const id of boss.drills ?? []) {
      const drill = drillsById.get(id);
      if (drill) appendDrill(segments, drill, 'assessment', 0);
    }
  }

  const totalSeconds = segments.reduce((s, seg) => s + seg.seconds, 0);
  const playSeconds = segments.filter((s) => s.kind === 'play').reduce((s, seg) => s + seg.seconds, 0);

  return {
    title: boss ? `${phase.name} — ${boss.name}` : `${phase.name} — Week ${day.week}`,
    phaseId: phase.id,
    phaseName: phase.name,
    isBoss: Boolean(boss),
    segments,
    totalSeconds,
    playSeconds,
  };
}
