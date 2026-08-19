/**
 * The instrument-pack contract.
 *
 * A pack is mostly data: what the instrument is, which skills are measured,
 * how a microphone can verify playing, and a declarative curriculum of phases
 * and drills. The engine (@sustain/core) compiles this into daily sessions.
 * Packs should be writable by teachers, not just programmers.
 */

export type MetricUnit = 'seconds' | 'minutes' | 'count' | 'cents' | 'hz';

/** A measurable skill dimension, e.g. longest unbroken drone. */
export interface MetricDef {
  id: string;
  name: string;
  unit: MetricUnit;
  /** Which direction is an improvement. */
  direction: 'higher' | 'lower';
  description: string;
  /**
   * 'auto': only a mic analyzer can measure it.
   * 'self-report': the player attests to it after a session.
   * 'either': analyzer when available, self-report otherwise.
   */
  measurement: 'auto' | 'self-report' | 'either';
}

/**
 * How the audio pipeline should verify playing for this instrument.
 * 'timer' packs work with no microphone at all; 'energy' needs only
 * loudness; 'pitch' enables full verification and auto-measured metrics
 * for monophonic instruments. Polyphonic analysis (guitar chords) is a
 * planned kind — the contract will grow, existing packs stay valid.
 */
export interface AnalyzerSpec {
  kind: 'timer' | 'energy' | 'pitch';
  pitch?: {
    /** Expected fundamental range while playing, in Hz. */
    minHz: number;
    maxHz: number;
    /** Minimum pitch-detector clarity (0-1) to count as playing. */
    minClarity: number;
    /**
     * Max wander (in semitones) over the stability window for the sound to
     * count as sustained rather than speech/noise. Omit for melodic
     * instruments where pitch is expected to move.
     */
    stabilitySemitones?: number;
    /** Reject 50/60 Hz mains hum masquerading as a drone. */
    rejectMainsHum?: boolean;
  };
}

/** Gate on a drill: what must be demonstrated before it unlocks. */
export type Prerequisite =
  | { kind: 'metric'; metric: string; gte: number }
  | { kind: 'self-report'; id: string; prompt: string }
  | { kind: 'drill-completed'; drill: string; times?: number };

export type StepKind = 'play' | 'rest' | 'instruction' | 'record';

/** One timed step inside a drill. */
export interface DrillStep {
  kind: StepKind;
  seconds: number;
  /** Short cue, shown and spoken at the start of the step. */
  cue: string;
  /** Optional longer coaching text, shown but not spoken. */
  detail?: string;
  /** For 'play' steps: the metric this step accrues toward or measures. */
  metric?: string;
}

export interface Drill {
  id: string;
  name: string;
  description: string;
  /** What success looks like, in the player's terms. */
  goal?: string;
  steps: DrillStep[];
  requires?: Prerequisite[];
  /** True for drills done away from the instrument (e.g. breath drills). */
  offInstrument?: boolean;
}

/** A slot in a session: a role, a pool of drills to rotate, a time budget. */
export interface SessionSlot {
  role: 'warmup' | 'skill' | 'endurance' | 'cooldown';
  /** Drill ids; the compiler rotates through unlocked ones by day index. */
  drills: string[];
  /** Fixed minutes, or a ramp across the phase from start to end. */
  minutes: number | { start: number; end: number };
}

export interface BossAssessment {
  name: string;
  description: string;
  /** Metrics measured during the assessment session. */
  metrics: string[];
  /** Drills appended to the boss session (e.g. a summit recording). */
  drills?: string[];
}

export interface Phase {
  id: string;
  name: string;
  /** Inclusive week range within the program, 1-based. */
  weeks: [number, number];
  focus: string;
  sessionPlan: SessionSlot[];
  /** One-off drills prepended to the first session of the phase. */
  firstSessionDrills?: string[];
  /** Run in the final scheduled session of the phase. */
  bossAssessment?: BossAssessment;
}

export interface InstrumentPack {
  id: string;
  name: string;
  version: string;
  description: string;
  instrument: {
    name: string;
    family: 'wind' | 'brass' | 'woodwind' | 'string' | 'voice' | 'percussion' | 'other';
  };
  schedule: {
    /** Practice days per week; the rest are scheduled rest days. */
    daysPerWeek: number;
    totalWeeks: number;
  };
  metrics: MetricDef[];
  analyzer: AnalyzerSpec;
  drills: Drill[];
  phases: Phase[];
}
