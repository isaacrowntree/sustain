import type { InstrumentPack } from '@sustain/pack-sdk';
import type { CompiledSession } from '@sustain/core';
import { EnergySource, PitchSource, type PracticeSource } from '@sustain/audio';
import { PracticeScene } from '../scene/scene.js';
import {
  SessionPlayer,
  type SessionProgressSnapshot,
  type SessionResult,
} from '../session-player.js';
import { el, fmtClock } from './format.js';

export interface SessionUiOptions {
  /** Resume an interrupted session at its saved position. */
  resumeFrom?: SessionProgressSnapshot;
  /** Start held, so a long interruption doesn't drop you mid-drill. */
  startPaused?: boolean;
  onSnapshot?(snapshot: SessionProgressSnapshot): void;
}

export function renderSession(
  root: HTMLElement,
  pack: InstrumentPack,
  session: CompiledSession,
  recordingKeyPrefix: string,
  onDone: (result: SessionResult) => void,
  uiOptions: SessionUiOptions = {},
): void {
  const canvas = el('canvas');
  const cue = el('div', { class: 'hud-cue' }, session.title);
  const detail = el('div', { class: 'hud-detail' }, '');
  const count = el('div', { class: 'hud-count' }, '');
  const micBadge = el('span', { class: 'mic-badge' }, 'timer mode');
  // Live input level — proof the app can hear you, independent of whether
  // what it hears counts as a drone yet.
  const levelFill = el('div', { class: 'level-fill' });
  const level = el('div', { class: 'level', title: 'Microphone input level' }, levelFill);
  const pitchRead = el('span', { class: 'pitch-read' }, '');
  const meter = el('div', { class: 'meter' }, level, pitchRead);
  const runInfo = el('span', {}, '');
  const remainInfo = el('span', {}, '');
  const fill = el('div', { class: 'fill' });
  const scrubHandle = el('div', { class: 'scrub-handle' });
  const progress = el(
    'div',
    { class: 'progress', role: 'slider', tabindex: '0', 'aria-label': 'Session position' },
    fill,
    scrubHandle,
  );

  const backBtn = el('button', { class: 'ghost step', title: 'Back 30 seconds' }, '−30s');
  const fwdBtn = el('button', { class: 'ghost step', title: 'Forward 30 seconds' }, '+30s');
  const micBtn = el('button', { class: 'secondary' }, 'Enable mic');
  const pauseBtn = el('button', { class: 'secondary' }, uiOptions.startPaused ? 'Resume' : 'Pause');
  const endBtn = el('button', { class: 'ghost' }, 'End');

  const hud = el(
    'div',
    { class: 'hud' },
    el(
      'div',
      { class: 'hud-top' },
      el('div', { class: 'hud-title' }, session.title),
      el('div', { class: 'hud-mic' }, meter, micBadge),
    ),
    el('div', { class: 'hud-center' }, count, cue, detail),
    el(
      'div',
      { class: 'hud-bottom' },
      el('div', { class: 'hud-meta' }, runInfo, remainInfo),
      progress,
      el('div', { class: 'hud-buttons' }, backBtn, micBtn, pauseBtn, fwdBtn, endBtn),
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

  // Flow-state HUD: chrome fades during stable play, any input re-summons it.
  let lastActivity = performance.now();
  const wake = () => {
    lastActivity = performance.now();
    hud.classList.remove('quiet');
  };
  screen.addEventListener('pointermove', wake);
  screen.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);

  let micVerified = uiOptions.resumeFrom?.verified ?? false;
  const player = new SessionPlayer(session, {
    recordingKeyPrefix,
    resumeFrom: uiOptions.resumeFrom,
    onSnapshot: uiOptions.onSnapshot,
    onSegmentChange(seg, index) {
      cue.textContent = seg.cue;
      detail.textContent = seg.detail ?? seg.drillName;
      if (index > 0) scene.pulseBoundary();
      wake();
    },
    onTick(t) {
      count.textContent = fmtClock(t.segmentRemaining + 0.999);
      remainInfo.textContent = `${fmtClock(t.totalRemaining)} left`;
      // A "run" is only meaningful when the mic is actually measuring one.
      runInfo.textContent =
        micVerified && t.currentRunMs > 1500 ? `run ${fmtClock(t.currentRunMs / 1000)}` : '';
      const pct = Math.min(100, (t.elapsed / session.totalSeconds) * 100);
      fill.style.width = `${pct}%`;
      scrubHandle.style.left = `${pct}%`;

      // Decibel scaling: raw RMS spends its whole life near zero, so a
      // linear map makes both the meter and the scene look dead.
      const db = 20 * Math.log10(Math.max(t.rms, 1e-5));
      const inputLevel = t.micActive ? Math.min(1, Math.max(0, (db + 60) / 50)) : 0;
      if (t.micActive) {
        levelFill.style.width = `${inputLevel * 100}%`;
        level.classList.toggle('counting', t.playing);
        pitchRead.textContent = t.pitchHz && t.playing ? `${Math.round(t.pitchHz)} Hz` : '';
      }
      if (performance.now() - lastActivity > 9000) hud.classList.add('quiet');
      scene.update(t.elapsed, t.segmentIndex, inputLevel, t.playing, micVerified ? t.currentRunMs : 0);
    },
    onFinish(result) {
      window.removeEventListener('keydown', wake);
      cleanup();
      onDone(result);
    },
  });

  /**
   * Turn the microphone on. Called automatically when a session starts —
   * the Start tap is the user gesture browsers require — and available on
   * the button if that was declined or the session was resumed.
   */
  const enableMic = async (): Promise<void> => {
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
      micBadge.textContent = verified ? 'listening' : 'mic on';
      micBadge.classList.add('live');
      meter.classList.add('live');
      micBtn.remove();
    } catch {
      micBadge.textContent = 'mic off — tap to enable';
      micBtn.disabled = false;
      micBtn.textContent = 'Enable mic';
    }
  };

  micBtn.addEventListener('click', () => void enableMic());

  pauseBtn.addEventListener('click', () => {
    if (player.paused) {
      player.resume();
      pauseBtn.textContent = 'Pause';
    } else {
      player.pause();
      pauseBtn.textContent = 'Resume';
    }
  });

  backBtn.addEventListener('click', () => {
    player.seekBy(-30);
    wake();
  });
  fwdBtn.addEventListener('click', () => {
    player.seekBy(30);
    wake();
  });

  // Scrub the session: press anywhere on the bar and drag.
  const seekFromPointer = (clientX: number) => {
    const rect = progress.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    player.seekTo(ratio * session.totalSeconds);
    wake();
  };
  progress.addEventListener('pointerdown', (e) => {
    progress.setPointerCapture(e.pointerId);
    progress.classList.add('scrubbing');
    seekFromPointer(e.clientX);
  });
  progress.addEventListener('pointermove', (e) => {
    if (progress.hasPointerCapture(e.pointerId)) seekFromPointer(e.clientX);
  });
  const endScrub = (e: PointerEvent) => {
    if (!progress.hasPointerCapture(e.pointerId)) return;
    progress.releasePointerCapture(e.pointerId);
    progress.classList.remove('scrubbing');
  };
  progress.addEventListener('pointerup', endScrub);
  progress.addEventListener('pointercancel', endScrub);
  progress.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') player.seekBy(-30);
    else if (e.key === 'ArrowRight') player.seekBy(30);
    else if (e.key === 'Home') player.seekTo(0);
    else return;
    e.preventDefault();
    wake();
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

  void player.start().then(() => {
    if (uiOptions.startPaused) player.pause();
  });

  // Ask for the microphone straight away on a fresh session: this call is
  // still inside the Start tap, which is what the browser wants to see. On
  // a resumed session there's no gesture to spend, so wait to be asked.
  if (uiOptions.resumeFrom) {
    micBadge.textContent = 'mic off — tap to enable';
  } else {
    void enableMic();
  }

  // A reload or a closed tab shouldn't cost more than the last second.
  const persistNow = () => uiOptions.onSnapshot?.(player.snapshotNow());
  window.addEventListener('pagehide', persistNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow();
  });
}
