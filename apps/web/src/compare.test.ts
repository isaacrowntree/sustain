import { describe, expect, it } from 'vitest';
import { didgeridooPack as pack } from '@sustain/pack-didgeridoo';
import { emptyProgress, addDays } from '@sustain/core';
import { baselineDrillFor, parseRecordingKey, selectComparison, summitDrillFor } from './compare.js';
import { renderCompare, type CompareDeps } from './ui/compare.js';
import { mondayOf } from '@sustain/core';
import { today } from './state.js';

const P = pack.id;

describe('selectComparison', () => {
  it('finds the day-one and week-16 recording drills from the pack', () => {
    expect(baselineDrillFor(pack)?.id).toBe('baseline-recording');
    expect(summitDrillFor(pack)?.id).toBe('summit-recording');
  });

  it('parses recording keys and ignores keys for other packs', () => {
    expect(parseRecordingKey(`${P}:2026-08-24:baseline-recording`, P)).toEqual({
      date: '2026-08-24',
      drillId: 'baseline-recording',
    });
    expect(parseRecordingKey('trombone:2026-08-24:baseline-recording', P)).toBeNull();
    expect(parseRecordingKey(`${P}:active`, P)).toBeNull();
  });

  it('picks the earliest baseline and the latest summit', () => {
    const keys = [
      `${P}:2026-08-25:baseline-recording`,
      `${P}:2026-08-24:baseline-recording`,
      `${P}:2026-12-11:summit-recording`,
      `${P}:2026-12-12:summit-recording`,
      `${P}:2026-09-01:drone-holds`,
      'trombone:2026-01-01:summit-recording',
    ];
    const c = selectComparison(pack, keys);
    expect(c.baseline?.key).toBe(`${P}:2026-08-24:baseline-recording`);
    expect(c.summit?.key).toBe(`${P}:2026-12-12:summit-recording`);
  });

  it('reports a missing summit as null while keeping the baseline', () => {
    const c = selectComparison(pack, [`${P}:2026-08-24:baseline-recording`]);
    expect(c.baseline?.date).toBe('2026-08-24');
    expect(c.summit).toBeNull();
    expect(c.summitDrill?.id).toBe('summit-recording');
  });
});

describe('renderCompare', () => {
  const fakeDeps = (keys: string[]): CompareDeps => ({
    listKeys: async () => keys,
    load: async () => new Blob(['x'], { type: 'audio/webm' }),
  });

  it('labels both recordings and offers back-to-back play when both exist', async () => {
    const root = document.createElement('div');
    const state = emptyProgress(P, '2026-08-24');
    const c = await renderCompare(
      root,
      pack,
      state,
      { onBack() {} },
      fakeDeps([`${P}:2026-08-24:baseline-recording`, `${P}:2026-12-11:summit-recording`]),
    );
    expect(c.baseline).not.toBeNull();
    expect(c.summit).not.toBeNull();
    const labels = [...root.querySelectorAll('.compare-label')].map((n) => n.textContent);
    expect(labels).toEqual(['Day-one recording', 'Summit recording']);
    const dates = [...root.querySelectorAll('.compare-date')].map((n) => n.textContent);
    expect(dates).toEqual(['24 Aug 2026', '11 Dec 2026']);
    expect(root.querySelectorAll('.compare-bar').length).toBe(2);
    const play = root.querySelector('button.start-btn') as HTMLButtonElement;
    expect(play.textContent).toBe('Play both, back to back');
    expect(play.disabled).toBe(false);
  });

  it('says the summit is not recorded yet, with the current week', async () => {
    const root = document.createElement('div');
    // Start five weeks ago so today lands in week 6.
    const start = addDays(mondayOf(today()), -5 * 7);
    const state = emptyProgress(P, start);
    const c = await renderCompare(
      root,
      pack,
      state,
      { onBack() {} },
      fakeDeps([`${P}:${start}:baseline-recording`]),
    );
    expect(c.summit).toBeNull();
    const rows = root.querySelectorAll('.compare-track');
    expect(rows[1]?.classList.contains('missing')).toBe(true);
    expect(rows[1]?.querySelector('.compare-time')?.textContent).toBe(
      `not recorded yet, week 6 of ${pack.schedule.totalWeeks}`,
    );
    const play = root.querySelector('button.start-btn') as HTMLButtonElement;
    expect(play.textContent).toBe('Play day-one recording');
    expect(play.disabled).toBe(false);
  });

  it('disables play when nothing has been recorded', async () => {
    const root = document.createElement('div');
    await renderCompare(root, pack, emptyProgress(P, '2026-08-24'), { onBack() {} }, fakeDeps([]));
    const play = root.querySelector('button.start-btn') as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    expect(root.querySelectorAll('.compare-track.missing').length).toBe(2);
  });
});
