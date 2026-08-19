import { z } from 'zod';
import type { InstrumentPack } from './types.js';

const metricDef = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  unit: z.enum(['seconds', 'minutes', 'count', 'cents', 'hz']),
  direction: z.enum(['higher', 'lower']),
  description: z.string(),
  measurement: z.enum(['auto', 'self-report', 'either']),
});

const analyzerSpec = z.object({
  kind: z.enum(['timer', 'energy', 'pitch']),
  pitch: z
    .object({
      minHz: z.number().positive(),
      maxHz: z.number().positive(),
      minClarity: z.number().min(0).max(1),
      stabilitySemitones: z.number().positive().optional(),
      rejectMainsHum: z.boolean().optional(),
    })
    .optional(),
});

const prerequisite = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('metric'), metric: z.string(), gte: z.number() }),
  z.object({ kind: z.literal('self-report'), id: z.string(), prompt: z.string() }),
  z.object({ kind: z.literal('drill-completed'), drill: z.string(), times: z.number().int().positive().optional() }),
]);

const drillStep = z.object({
  kind: z.enum(['play', 'rest', 'instruction', 'record']),
  seconds: z.number().positive(),
  cue: z.string().min(1),
  detail: z.string().optional(),
  metric: z.string().optional(),
});

const drill = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  goal: z.string().optional(),
  steps: z.array(drillStep).min(1),
  requires: z.array(prerequisite).optional(),
  offInstrument: z.boolean().optional(),
});

const sessionSlot = z.object({
  role: z.enum(['warmup', 'skill', 'endurance', 'cooldown']),
  drills: z.array(z.string()).min(1),
  minutes: z.union([
    z.number().positive(),
    z.object({ start: z.number().positive(), end: z.number().positive() }),
  ]),
});

const phase = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  weeks: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  focus: z.string(),
  sessionPlan: z.array(sessionSlot).min(1),
  firstSessionDrills: z.array(z.string()).optional(),
  bossAssessment: z
    .object({
      name: z.string(),
      description: z.string(),
      metrics: z.array(z.string()),
      drills: z.array(z.string()).optional(),
    })
    .optional(),
});

export const instrumentPackSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'pack id must be kebab-case'),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string(),
  instrument: z.object({
    name: z.string().min(1),
    family: z.enum(['wind', 'brass', 'woodwind', 'string', 'voice', 'percussion', 'other']),
  }),
  schedule: z.object({
    daysPerWeek: z.number().int().min(1).max(7),
    totalWeeks: z.number().int().min(1),
  }),
  metrics: z.array(metricDef),
  analyzer: analyzerSpec,
  drills: z.array(drill).min(1),
  phases: z.array(phase).min(1),
});

export interface PackIssue {
  path: string;
  message: string;
}

/**
 * Validate a pack: structural (zod) plus referential integrity —
 * every drill/metric referenced by phases, steps, and prerequisites
 * must exist, and phase week ranges must tile the program contiguously.
 */
export function validatePack(input: unknown): { pack?: InstrumentPack; issues: PackIssue[] } {
  const parsed = instrumentPackSchema.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const pack = parsed.data as InstrumentPack;
  const issues: PackIssue[] = [];

  const metricIds = new Set(pack.metrics.map((m) => m.id));
  const drillIds = new Set(pack.drills.map((d) => d.id));

  if (drillIds.size !== pack.drills.length) {
    issues.push({ path: 'drills', message: 'duplicate drill ids' });
  }
  if (metricIds.size !== pack.metrics.length) {
    issues.push({ path: 'metrics', message: 'duplicate metric ids' });
  }

  pack.drills.forEach((d, di) => {
    d.steps.forEach((s, si) => {
      if (s.metric && !metricIds.has(s.metric)) {
        issues.push({ path: `drills.${di}.steps.${si}`, message: `unknown metric '${s.metric}'` });
      }
    });
    d.requires?.forEach((r, ri) => {
      if (r.kind === 'metric' && !metricIds.has(r.metric)) {
        issues.push({ path: `drills.${di}.requires.${ri}`, message: `unknown metric '${r.metric}'` });
      }
      if (r.kind === 'drill-completed' && !drillIds.has(r.drill)) {
        issues.push({ path: `drills.${di}.requires.${ri}`, message: `unknown drill '${r.drill}'` });
      }
    });
  });

  pack.phases.forEach((p, pi) => {
    if (p.weeks[0] > p.weeks[1]) {
      issues.push({ path: `phases.${pi}.weeks`, message: 'week range start exceeds end' });
    }
    p.sessionPlan.forEach((slot, si) => {
      slot.drills.forEach((id) => {
        if (!drillIds.has(id)) {
          issues.push({ path: `phases.${pi}.sessionPlan.${si}`, message: `unknown drill '${id}'` });
        }
      });
    });
    p.firstSessionDrills?.forEach((id) => {
      if (!drillIds.has(id)) {
        issues.push({ path: `phases.${pi}.firstSessionDrills`, message: `unknown drill '${id}'` });
      }
    });
    p.bossAssessment?.metrics.forEach((id) => {
      if (!metricIds.has(id)) {
        issues.push({ path: `phases.${pi}.bossAssessment`, message: `unknown metric '${id}'` });
      }
    });
    p.bossAssessment?.drills?.forEach((id) => {
      if (!drillIds.has(id)) {
        issues.push({ path: `phases.${pi}.bossAssessment`, message: `unknown drill '${id}'` });
      }
    });
  });

  const sorted = [...pack.phases].sort((a, b) => a.weeks[0] - b.weeks[0]);
  let expected = 1;
  for (const p of sorted) {
    if (p.weeks[0] !== expected) {
      issues.push({ path: `phases.${p.id}.weeks`, message: `phases must tile weeks contiguously; expected week ${expected}, got ${p.weeks[0]}` });
      break;
    }
    expected = p.weeks[1] + 1;
  }
  const last = sorted[sorted.length - 1];
  if (last && last.weeks[1] !== pack.schedule.totalWeeks) {
    issues.push({ path: 'phases', message: `phases end at week ${last.weeks[1]} but schedule.totalWeeks is ${pack.schedule.totalWeeks}` });
  }

  if (pack.analyzer.kind === 'pitch' && !pack.analyzer.pitch) {
    issues.push({ path: 'analyzer', message: "analyzer.kind 'pitch' requires analyzer.pitch config" });
  }

  return issues.length === 0 ? { pack, issues } : { issues };
}
