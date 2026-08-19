import './style.css';
import { didgeridooPack } from '@sustain/pack-didgeridoo';
import { validatePack } from '@sustain/pack-sdk';
import {
  compileSession,
  completedDrillSet,
  pendingFirstSessionDrills,
  programDayFor,
  recordDrillCompletion,
  recordMetric,
  recordSession,
  unlockedDrills,
  type CompiledSession,
  type ISODate,
  type ProgressState,
} from '@sustain/core';
import {
  beginProgram,
  clearActiveSession,
  IndexedDBProgressStore,
  loadActiveSession,
  saveActiveSession,
  today,
  type ActiveSession,
} from './state.js';
import { renderHome, renderWelcome } from './ui/home.js';
import { renderSession } from './ui/session.js';
import { renderComplete } from './ui/complete.js';
import { listRecordingKeys } from './recordings.js';
import type { SessionResult } from './session-player.js';

const pack = didgeridooPack;

// Fail loudly in dev if the shipped pack ever drifts from the contract.
const { issues } = validatePack(pack);
if (issues.length > 0) {
  console.error('[sustain] pack validation failed', issues);
}

const store = new IndexedDBProgressStore(pack.id);
const root = document.getElementById('app')!;
let current: ProgressState | null = null;

function showHome(): void {
  if (!current) {
    renderWelcome(root, pack, {
      onBegin() {
        void beginProgram(pack, store).then((state) => {
          current = state;
          showHome();
        });
      },
      onStartSession() {},
    });
    return;
  }
  renderHome(root, pack, current, {
    onBegin() {},
    onStartSession() {
      startSession();
    },
  });
}

function startSession(): void {
  const state = current;
  if (!state) return showHome();
  // The session is dated when it starts: one that runs past midnight still
  // belongs to the evening it was practiced on.
  const sessionDate = today();
  const day = programDayFor(pack, state.startDate, sessionDate);
  const outstanding = day.phase ? pendingFirstSessionDrills(state, day.phase) : [];
  const session = compileSession(pack, day, unlockedDrills(pack, state), {
    firstSessionOfPhase: outstanding.length > 0,
    completedDrills: completedDrillSet(state),
    makeup: day.isRestDay,
  });
  if (!session) return showHome();

  const recordingKeyPrefix = `${pack.id}:${sessionDate}`;
  runSession(
    {
      version: 1,
      packId: pack.id,
      date: sessionDate,
      dayIndex: day.dayIndex,
      isBossSession: day.isBossSession,
      isRestDayMakeup: day.isRestDay,
      session,
      recordingKeyPrefix,
      elapsed: 0,
      verified: false,
      verifiedPlayMs: 0,
      metricRuns: {},
      savedAtMs: Date.now(),
    },
    false,
  );
}

/**
 * Run a session — new or resumed — keeping a snapshot on disk throughout so
 * a reload, a closed tab, or a flat battery costs you your place and nothing
 * more. A gap long enough that you clearly walked away resumes held, so you
 * don't come back mid-drill with the clock running.
 */
function runSession(active: ActiveSession, isResume: boolean): void {
  const { session } = active;
  const gapMs = Date.now() - active.savedAtMs;

  renderSession(
    root,
    pack,
    session,
    active.recordingKeyPrefix,
    (result) => {
      void clearActiveSession(pack.id);
      finishSession(
        session,
        result,
        { dayIndex: active.dayIndex, isBossSession: active.isBossSession },
        active.date,
      );
    },
    {
      resumeFrom: isResume ? active : undefined,
      startPaused: isResume && gapMs > 90_000,
      onSnapshot(snapshot) {
        void saveActiveSession({ ...active, ...snapshot, savedAtMs: Date.now() });
      },
    },
  );
}

function finishSession(
  session: CompiledSession,
  result: SessionResult,
  day: { dayIndex: number; isBossSession: boolean },
  date: ISODate,
): void {
  const state = current;
  if (!state) return showHome();
  const prFlashes: string[] = [];

  // A meaningfully attempted session counts; a bailed-in-two-minutes one doesn't.
  const counts = !result.aborted || result.completedSeconds >= session.totalSeconds * 0.5;
  if (counts) {
    recordSession(state, {
      date,
      dayIndex: day.dayIndex,
      completedSeconds: result.completedSeconds,
      playSeconds: result.playSeconds,
      verified: result.verified,
      isBoss: day.isBossSession,
    });
    for (const drillId of result.completedDrillIds) {
      recordDrillCompletion(state, drillId);
    }
  }

  // Mic-verified runs become records automatically.
  for (const [metricId, seconds] of Object.entries(result.metricRuns)) {
    if (seconds <= 0) continue;
    const r = recordMetric(state, pack, metricId, seconds, date, true);
    const def = pack.metrics.find((m) => m.id === metricId);
    if (r.isPersonalRecord && def) {
      prFlashes.push(
        r.previousBest === null
          ? `First measured ${def.name.toLowerCase()}: ${seconds}s`
          : `${def.name}: ${seconds}s — beats ${r.previousBest}s`,
      );
    }
  }

  void store.save(state);
  renderComplete(root, pack, state, session, result, prFlashes, date, () => {
    void store.save(state);
    showHome();
  });
}

/**
 * A recording drill that left no audio behind wasn't really done — the
 * microphone was off, or permission was declined. Put it back on the
 * schedule so the day-one recording isn't lost to a silent failure.
 */
async function reconcileRecordings(state: ProgressState): Promise<boolean> {
  const recordingDrills = pack.drills
    .filter((d) => d.steps.some((s) => s.kind === 'record'))
    .map((d) => d.id)
    .filter((id) => (state.drillCompletions[id] ?? 0) > 0);
  if (recordingDrills.length === 0) return false;

  const keys = await listRecordingKeys();
  let changed = false;
  for (const id of recordingDrills) {
    if (!keys.some((k) => k.endsWith(`:${id}`))) {
      state.drillCompletions[id] = 0;
      changed = true;
    }
  }
  return changed;
}

void (async () => {
  current = await store.load();
  if (current && (await reconcileRecordings(current))) {
    await store.save(current);
  }
  const active = current ? await loadActiveSession(pack.id) : null;
  if (active) {
    runSession(active, true);
    return;
  }
  showHome();
})();
