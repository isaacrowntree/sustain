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
} from '@sustain/core';
import { beginProgram, LocalStorageStore, today } from './state.js';
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

const store = new LocalStorageStore(pack.id);
const root = document.getElementById('app')!;

function showHome(): void {
  const state = store.load();
  if (!state) {
    renderWelcome(root, pack, {
      onBegin() {
        beginProgram(pack, store);
        showHome();
      },
      onStartSession() {},
    });
    return;
  }
  renderHome(root, pack, state, {
    onBegin() {},
    onStartSession() {
      startSession();
    },
  });
}

function startSession(): void {
  const state = store.load();
  if (!state) return showHome();
  const day = programDayFor(pack, state.startDate, today());
  const session = compileSession(pack, day, unlockedDrills(pack, state), {
    firstSessionOfPhase: day.phase ? !hasSessionInPhase(state, day.phase) : false,
  });
  if (!session) return showHome();

  renderSession(root, pack, session, `${pack.id}:${today()}`, (result) => {
    finishSession(session, result, day.dayIndex, day.isBossSession);
  });
}

function finishSession(
  session: CompiledSession,
  result: SessionResult,
  dayIndex: number,
  isBoss: boolean,
): void {
  const state = store.load();
  if (!state) return showHome();
  const date = today();
  const prFlashes: string[] = [];

  // A meaningfully attempted session counts; a bailed-in-two-minutes one doesn't.
  const counts = !result.aborted || result.completedSeconds >= session.totalSeconds * 0.5;
  if (counts) {
    recordSession(state, {
      date,
      dayIndex,
      completedSeconds: result.completedSeconds,
      playSeconds: result.playSeconds,
      verified: result.verified,
      isBoss,
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

  store.save(state);
  renderComplete(root, pack, state, session, result, prFlashes, () => {
    store.save(state);
    showHome();
  });
}

showHome();
