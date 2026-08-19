import type { InstrumentPack } from '@sustain/pack-sdk';
import {
  pendingSelfReports,
  recordMetric,
  type CompiledSession,
  type ProgressState,
} from '@sustain/core';
import { today } from '../state.js';
import type { SessionResult } from '../session-player.js';
import { el, fmtMinutes } from './format.js';

/**
 * Post-session debrief: auto-recorded PRs in verified mode, honest numbers
 * by hand otherwise, plus any self-report gates that unlock the next drills.
 * Mutates state; the caller saves and re-renders home on finish.
 */
export function renderComplete(
  root: HTMLElement,
  pack: InstrumentPack,
  state: ProgressState,
  session: CompiledSession,
  result: SessionResult,
  prFlashes: string[],
  onContinue: () => void,
): void {
  const date = today();
  const screen = el('div', { class: 'screen' });
  screen.append(el('h1', {}, result.aborted ? 'Session ended early' : 'Session complete'));

  const summary = el(
    'div',
    { class: 'card hero' },
    el(
      'div',
      { class: 'stat-row' },
      el('div', { class: 'stat' }, el('div', { class: 'v' }, fmtMinutes(result.completedSeconds)), el('div', { class: 'l' }, 'session')),
      el(
        'div',
        { class: 'stat' },
        el('div', { class: 'v' }, fmtMinutes(result.playSeconds)),
        el('div', { class: 'l' }, result.verified ? 'verified playing' : 'playing (timer)'),
      ),
    ),
  );
  for (const flash of prFlashes) {
    summary.append(el('p', { class: 'pr-flash' }, `★ ${flash}`));
  }
  screen.append(summary);

  // Manual metric entry when the mic didn't verify: the numbers stay honest
  // because they gate real unlocks the player wants to earn legitimately.
  const sessionMetrics = [...new Set(session.segments.filter((s) => s.kind === 'play' && s.metric).map((s) => s.metric!))];
  const manualMetrics = result.verified ? [] : sessionMetrics;
  const inputs = new Map<string, HTMLInputElement>();
  if (manualMetrics.length > 0) {
    const card = el('div', { class: 'card' }, el('h2', {}, 'How did it go?'), el('p', { class: 'sub' }, 'Rough numbers are fine. They set your records and unlock what comes next.'));
    const list = el('div', { class: 'prompt-list' });
    for (const id of manualMetrics) {
      const def = pack.metrics.find((m) => m.id === id);
      if (!def || def.measurement === 'auto') continue;
      const input = el('input', { type: 'number', min: '0', inputmode: 'numeric', placeholder: '0' });
      inputs.set(id, input);
      list.append(
        el(
          'div',
          { class: 'prompt' },
          el('div', { class: 'q' }, `${def.name} today (${def.unit})`),
          input,
        ),
      );
    }
    card.append(list);
    screen.append(card);
  }

  // Self-report gates (e.g. "can you keep the bubbles unbroken?").
  const reports = pendingSelfReports(pack, state);
  const reportAnswers = new Map<string, boolean>();
  if (reports.length > 0 && !result.aborted) {
    const card = el('div', { class: 'card' }, el('h2', {}, 'Checkpoint'));
    const list = el('div', { class: 'prompt-list' });
    for (const r of reports) {
      const yes = el('button', { class: 'secondary' }, 'Yes');
      const notYet = el('button', { class: 'secondary' }, 'Not yet');
      const row = el('div', { class: 'prompt' }, el('div', { class: 'q' }, r.prompt), el('div', { class: 'opts' }, yes, notYet));
      yes.addEventListener('click', () => {
        reportAnswers.set(r.id, true);
        yes.style.background = 'var(--good)';
        yes.style.color = '#10241a';
        notYet.style.opacity = '0.4';
      });
      notYet.addEventListener('click', () => {
        reportAnswers.set(r.id, false);
        notYet.style.opacity = '1';
        yes.style.background = '';
        yes.style.color = '';
      });
      list.append(row);
    }
    card.append(list);
    screen.append(card);
  }

  const done = el('button', {}, 'Done');
  done.addEventListener('click', () => {
    for (const [id, input] of inputs) {
      const v = Number(input.value);
      if (Number.isFinite(v) && v > 0) {
        recordMetric(state, pack, id, v, date, false);
      }
    }
    for (const [id, answer] of reportAnswers) {
      if (answer) state.selfReports[id] = true;
    }
    onContinue();
  });
  screen.append(done);

  root.replaceChildren(screen);
}
