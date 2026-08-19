import { describe, expect, it } from 'vitest';
import { validatePack } from '@sustain/pack-sdk';
import { didgeridooPack } from './index.js';

describe('didgeridoo pack', () => {
  it('passes full pack validation', () => {
    const { pack, issues } = validatePack(didgeridooPack);
    expect(issues).toEqual([]);
    expect(pack?.id).toBe('didgeridoo');
  });

  it('covers all 16 weeks with contiguous phases', () => {
    const weeks = didgeridooPack.phases.map((p) => p.weeks);
    expect(weeks[0]?.[0]).toBe(1);
    expect(weeks.at(-1)?.[1]).toBe(didgeridooPack.schedule.totalWeeks);
  });
});
