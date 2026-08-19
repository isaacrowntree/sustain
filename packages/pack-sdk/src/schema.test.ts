import { describe, expect, it } from 'vitest';
import { validatePack } from './schema.js';
import type { InstrumentPack } from './types.js';

const minimalPack: InstrumentPack = {
  id: 'test-pack',
  name: 'Test',
  version: '0.0.1',
  description: 'test',
  instrument: { name: 'Kazoo', family: 'wind' },
  schedule: { daysPerWeek: 5, totalWeeks: 2 },
  metrics: [
    { id: 'm1', name: 'M1', unit: 'seconds', direction: 'higher', description: '', measurement: 'either' },
  ],
  analyzer: { kind: 'timer' },
  drills: [
    { id: 'd1', name: 'D1', description: '', steps: [{ kind: 'play', seconds: 30, cue: 'go', metric: 'm1' }] },
  ],
  phases: [
    {
      id: 'p1',
      name: 'P1',
      weeks: [1, 2],
      focus: '',
      sessionPlan: [{ role: 'skill', drills: ['d1'], minutes: 5 }],
    },
  ],
};

describe('validatePack', () => {
  it('accepts a minimal valid pack', () => {
    const { pack, issues } = validatePack(minimalPack);
    expect(issues).toEqual([]);
    expect(pack?.id).toBe('test-pack');
  });

  it('rejects unknown drill references in session plans', () => {
    const broken = structuredClone(minimalPack);
    broken.phases[0]!.sessionPlan[0]!.drills = ['nope'];
    const { issues } = validatePack(broken);
    expect(issues.some((i) => i.message.includes("unknown drill 'nope'"))).toBe(true);
  });

  it('rejects unknown metric references in steps', () => {
    const broken = structuredClone(minimalPack);
    broken.drills[0]!.steps[0]!.metric = 'ghost';
    const { issues } = validatePack(broken);
    expect(issues.some((i) => i.message.includes("unknown metric 'ghost'"))).toBe(true);
  });

  it('rejects non-contiguous phase weeks', () => {
    const broken = structuredClone(minimalPack);
    broken.phases[0]!.weeks = [1, 1];
    const { issues } = validatePack(broken);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('requires pitch config for pitch analyzers', () => {
    const broken = structuredClone(minimalPack);
    broken.analyzer = { kind: 'pitch' };
    const { issues } = validatePack(broken);
    expect(issues.some((i) => i.path === 'analyzer')).toBe(true);
  });
});
