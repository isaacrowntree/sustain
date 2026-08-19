import './style.css';
import { didgeridooPack } from '@sustain/pack-didgeridoo';
import { validatePack } from '@sustain/pack-sdk';
import {
  compileSession,
  completedDrillSet,
  drillsDoneOn,
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
  const compile = (skipDrills?: Set<string>) =>
    compileSession(pack, day, unlockedDrills(pack, state), {
      firstSessionOfPhase: outstanding.length > 0,
      completedDrills: completedDrillSet(state),
      makeup: day.isRestDay,
      skipDrills,
    });

  // Pick up where the day left off; if there's nothing left to do, a
  // deliberate repeat gets the whole session again.
  const remaining = compile(drillsDoneOn(state, sessionDate));
  const session = remaining && remaining.segments.length > 0 ? remaining : compile();
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

  // Everything done is kept, however short the sitting — that's what makes
  // a day resumable. Whether the DAY counts toward the week is a separate
  // question, answered by how much of it is done in total.
  const alreadyDone = state.sessions.find((s) => s.date === date)?.completedSeconds ?? 0;
  const counts =
    !result.aborted || alreadyDone + result.completedSeconds >= session.totalSeconds * 0.5;
  recordSession(state, {
    date,
    dayIndex: day.dayIndex,
    completedSeconds: result.completedSeconds,
    playSeconds: result.playSeconds,
    verified: result.verified,
    isBoss: day.isBossSession,
    completedDrillIds: result.completedDrillIds,
    counted: counts,
  });
  for (const drillId of result.completedDrillIds) {
    recordDrillCompletion(state, drillId);
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
 * The recording store is the truth about recording drills, not the
 * completion count. Audio present means it's done however the session
 * ended; audio absent means it isn't, however the session was marked.
 */
async function reconcileRecordings(state: ProgressState): Promise<boolean> {
  const recordingDrills = pack.drills
    .filter((d) => d.steps.some((s) => s.kind === 'record'))
    .map((d) => d.id);
  if (recordingDrills.length === 0) return false;

  const keys = await listRecordingKeys();
  let changed = false;
  for (const id of recordingDrills) {
    const hasAudio = keys.some((k) => k.endsWith(`:${id}`));
    const marked = (state.drillCompletions[id] ?? 0) > 0;
    if (hasAudio && !marked) {
      state.drillCompletions[id] = 1;
      changed = true;
    } else if (!hasAudio && marked) {
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
