import type { InstrumentPack } from '@sustain/pack-sdk';
import { drills } from './drills.js';

/**
 * 16-week didgeridoo curriculum. Structure and dose follow Puhan et al.,
 * BMJ 2006;332:266 (the didgeridoo / obstructive sleep apnoea RCT):
 * ≥20 min/day, ≥5 days/week, 4 months, teaching drone holds, circular
 * breathing, and lip/vocal-tract interaction — extended here to a
 * 30–40 minute session ceiling with a gradual ramp.
 */
export const didgeridooPack: InstrumentPack = {
  id: 'didgeridoo',
  name: 'Didgeridoo',
  version: '0.1.0',
  description:
    'From first drone to sustained circular breathing in 16 weeks. Works with any didgeridoo, including PVC.',
  instrument: { name: 'Didgeridoo', family: 'wind' },
  schedule: { daysPerWeek: 5, totalWeeks: 16 },
  metrics: [
    {
      id: 'longest-drone',
      name: 'Longest drone',
      unit: 'seconds',
      direction: 'higher',
      description: 'Longest single-breath drone.',
      measurement: 'either',
    },
    {
      id: 'longest-unbroken',
      name: 'Longest unbroken sound',
      unit: 'seconds',
      direction: 'higher',
      description: 'Longest continuous sound across breaths — the circular-breathing metric.',
      measurement: 'either',
    },
  ],
  analyzer: {
    kind: 'pitch',
    pitch: {
      minHz: 50,
      maxHz: 100,
      // A beginner's drone wobbles and its clarity dips; too strict a gate
      // reads as "the app can't hear me". The 50-100 Hz band is what keeps
      // speech and room noise out, so these two can afford to be forgiving.
      minClarity: 0.8,
      stabilitySemitones: 3,
      rejectMainsHum: true,
    },
  },
  drills,
  phases: [
    {
      id: 'foundation',
      name: 'Foundation',
      weeks: [1, 2],
      focus: 'Find the drone. Unlearn brass tension — loose lips, gentle air, low breath.',
      firstSessionDrills: ['baseline-recording'],
      sessionPlan: [
        { role: 'warmup', drills: ['posture-breath', 'lip-flutter'], minutes: 4 },
        { role: 'skill', drills: ['first-drone', 'drone-holds'], minutes: { start: 6, end: 10 } },
        { role: 'cooldown', drills: ['soft-landing'], minutes: 2 },
      ],
      bossAssessment: {
        name: 'Foundation check',
        description: 'Three measured drone holds. The trial benchmark is a 20–30 second keynote.',
        metrics: ['longest-drone'],
      },
    },
    {
      id: 'breath-mechanics',
      name: 'Breath mechanics',
      weeks: [3, 5],
      focus: 'Cheeks become bellows. The circular-breathing drill ladder, mostly away from the instrument.',
      sessionPlan: [
        { role: 'warmup', drills: ['lip-flutter', 'cheek-puff-breathing'], minutes: 4 },
        { role: 'skill', drills: ['water-spray', 'straw-glass', 'squeeze-sniff'], minutes: { start: 8, end: 12 } },
        { role: 'endurance', drills: ['drone-holds'], minutes: { start: 6, end: 10 } },
        { role: 'cooldown', drills: ['soft-landing'], minutes: 2 },
      ],
      bossAssessment: {
        name: 'Breath machine',
        description: 'Measured drone holds after three weeks of bellows work — the holds should be visibly longer.',
        metrics: ['longest-drone'],
      },
    },
    {
      id: 'connection',
      name: 'Connection',
      weeks: [6, 9],
      focus: 'Circular breathing lands on the instrument. Bridge the breath, then shrink the join.',
      sessionPlan: [
        { role: 'warmup', drills: ['squeeze-sniff', 'lip-flutter'], minutes: 4 },
        { role: 'skill', drills: ['cb-on-didge', 'bridge-the-gap'], minutes: { start: 10, end: 14 } },
        { role: 'endurance', drills: ['endurance-drone'], minutes: { start: 10, end: 14 } },
        { role: 'cooldown', drills: ['soft-landing'], minutes: 2 },
      ],
      bossAssessment: {
        name: 'The loop',
        description: 'One measured attempt at your longest unbroken sound. Sixty seconds is the gate.',
        metrics: ['longest-unbroken'],
      },
    },
    {
      id: 'endurance-voice',
      name: 'Endurance & voice',
      weeks: [10, 16],
      focus: 'Long unbroken sets. Rhythm, voice, and toots turn the exercise into music.',
      sessionPlan: [
        { role: 'warmup', drills: ['squeeze-sniff', 'lip-flutter'], minutes: 4 },
        { role: 'skill', drills: ['rhythm-pulses', 'vocal-drone', 'toots'], minutes: { start: 8, end: 10 } },
        { role: 'endurance', drills: ['unbroken-sets', 'freeplay'], minutes: { start: 18, end: 24 } },
        { role: 'cooldown', drills: ['soft-landing'], minutes: 2 },
      ],
      bossAssessment: {
        name: 'Summit',
        description: 'Longest unbroken sound, longest drone, and the recording that answers day one.',
        metrics: ['longest-unbroken', 'longest-drone'],
        drills: ['summit-recording'],
      },
    },
  ],
};

export default didgeridooPack;
