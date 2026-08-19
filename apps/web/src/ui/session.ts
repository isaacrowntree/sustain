import type { InstrumentPack } from '@sustain/pack-sdk';
import type { CompiledSession } from '@sustain/core';
import { EnergySource, PitchSource, type PracticeSource } from '@sustain/audio';
import { PracticeScene } from '../scene/scene.js';
import { SessionPlayer, type SessionResult } from '../session-player.js';
import { el, fmtClock } from './format.js';

export function renderSession(
  root: HTMLElement,
  pack: InstrumentPack,
  session: CompiledSession,
  recordingKeyPrefix: string,
  onDone: (result: SessionResult) => void,
): void {
  const canvas = el('canvas');
  const cue = el('div', { class: 'hud-cue' }, session.title);
  const detail = el('div', { class: 'hud-detail' }, '');
  const count = el('div', { class: 'hud-count' }, '');
  const micBadge = el('span', { class: 'mic-badge' }, 'timer mode');
  const runInfo = el('span', {}, '');
  const remainInfo = el('span', {}, '');
  const fill = el('div', { class: 'fill' });
  const progress = el('div', { class: 'progress' }, fill);

  const micBtn = el('button', { class: 'secondary' }, 'Enable mic');
  const pauseBtn = el('button', { class: 'secondary' }, 'Pause');
  const endBtn = el('button', { class: 'ghost' }, 'End');

  const hud = el(
    'div',
    { class: 'hud' },
    el('div', { class: 'hud-top' }, el('div', { class: 'hud-title' }, session.title), micBadge),
    el('div', { class: 'hud-center' }, count, cue, detail),
    el(
      'div',
      { class: 'hud-bottom' },
      el('div', { class: 'hud-meta' }, runInfo, remainInfo),
      progress,
      el('div', { class: 'hud-buttons' }, micBtn, pauseBtn, endBtn),
    ),
  );

  const screen = el('div', { class: 'session-screen' }, canvas, hud);
  root.replaceChildren(screen);

  const scene = new PracticeScene(canvas);
  scene.setPhase(session.phaseId);
  scene.setSession(session.segments);
  const onResize = () => scene.resize();
  window.addEventListener('resize', onResize);

  let wakeLock: WakeLockSentinel | null = null;
  void navigator.wakeLock?.request('screen').then((wl) => (wakeLock = wl)).catch(() => {});

  const cleanup = () => {
    window.removeEventListener('resize', onResize);
    void wakeLock?.release();
    scene.dispose();
  };

  let micVerified = false;
  const player = new SessionPlayer(session, {
    recordingKeyPrefix,
    onSegmentChange(seg) {
      cue.textContent = seg.cue;
      detail.textContent = seg.detail ?? seg.drillName;
    },
    onTick(t) {
      count.textContent = fmtClock(t.segmentRemaining + 0.999);
      remainInfo.textContent = `${fmtClock(t.totalRemaining)} left`;
      // A "run" is only meaningful when the mic is actually measuring one.
      runInfo.textContent =
        micVerified && t.currentRunMs > 1500 ? `run ${fmtClock(t.currentRunMs / 1000)}` : '';
      fill.style.width = `${Math.min(100, (t.elapsed / session.totalSeconds) * 100)}%`;
      scene.update(t.elapsed, t.segmentIndex, t.rms, t.playing);
    },
    onFinish(result) {
      cleanup();
      onDone(result);
    },
  });

  micBtn.addEventListener('click', async () => {
    micBtn.disabled = true;
    try {
      let source: PracticeSource;
      let verified = false;
      if (pack.analyzer.kind === 'pitch' && pack.analyzer.pitch) {
        source = new PitchSource(pack.analyzer.pitch);
        verified = true;
      } else {
        source = new EnergySource();
      }
      await player.useSource(source, verified);
      micVerified = verified;
      micBadge.textContent = verified ? 'mic: verified' : 'mic: listening';
      micBadge.classList.add('live');
      micBtn.remove();
    } catch {
      micBadge.textContent = 'mic unavailable';
      micBtn.disabled = false;
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (player.paused) {
      player.resume();
      pauseBtn.textContent = 'Pause';
    } else {
      player.pause();
      pauseBtn.textContent = 'Resume';
    }
  });

  // Two-tap end: no blocking dialogs allowed over the render loop.
  let endArmed = false;
  endBtn.addEventListener('click', () => {
    if (!endArmed) {
      endArmed = true;
      endBtn.textContent = 'End session?';
      setTimeout(() => {
        endArmed = false;
        endBtn.textContent = 'End';
      }, 4000);
    } else {
      player.abort();
    }
  });

  void player.start();
}
