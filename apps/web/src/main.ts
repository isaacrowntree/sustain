import './style.css';
import { didgeridooPack } from '@sustain/pack-didgeridoo';
import { validatePack } from '@sustain/pack-sdk';
import {
  compileSession,
  hasSessionInPhase,
  programDayFor,
  recordDrillCompletion,
  recordMetric,
  recordSession,
  unlockedDrills,
  type CompiledSession,
  type ISODate,
  type ProgramDay,
  type ProgressState,
} from '@sustain/core';
import { beginProgram, IndexedDBProgressStore, today } from './state.js';
import { renderHome, renderWelcome } from './ui/home.js';
import { renderSession } from './ui/session.js';
import { renderComplete } from './ui/complete.js';
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
  const session = compileSession(pack, day, unlockedDrills(pack, state), {
    firstSessionOfPhase: day.phase ? !hasSessionInPhase(state, day.phase) : false,
    makeup: day.isRestDay,
  });
  if (!session) return showHome();

  renderSession(root, pack, session, `${pack.id}:${sessionDate}`, (result) => {
    finishSession(session, result, day, sessionDate);
  });
}

function finishSession(
  session: CompiledSession,
  result: SessionResult,
  day: ProgramDay,
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

void store.load().then((state) => {
  current = state;
  showHome();
});
