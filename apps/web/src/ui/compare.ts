import type { InstrumentPack } from '@sustain/pack-sdk';
import { programDayFor, type ProgressState } from '@sustain/core';
import { selectComparison, type Comparison, type RecordingRef } from '../compare.js';
import { listRecordingKeys, loadRecording } from '../recordings.js';
import { today } from '../state.js';
import { el, fmtClock, fmtDate } from './format.js';

export interface CompareCallbacks {
  onBack(): void;
}

/** Storage access, injectable so the view can be exercised without IndexedDB. */
export interface CompareDeps {
  listKeys(): Promise<string[]>;
  load(key: string): Promise<Blob | null>;
}

const defaultDeps: CompareDeps = {
  listKeys: listRecordingKeys,
  load: loadRecording,
};

interface Track {
  label: string;
  ref: RecordingRef | null;
  missingNote: string;
  row: HTMLElement;
  fill: HTMLElement;
  time: HTMLElement;
  /** Set when the last attempt to load or play it failed; the note stays up after stop. */
  failed: boolean;
}

function trackRow(label: string, ref: RecordingRef | null, missingNote: string): Track {
  const fill = el('div', { class: 'fill' });
  const time = el('span', { class: 'compare-time' }, ref ? '' : missingNote);
  const row = el(
    'div',
    { class: ref ? 'compare-track' : 'compare-track missing' },
    el(
      'div',
      { class: 'compare-head' },
      el('span', { class: 'compare-label' }, label),
      el('span', { class: 'compare-date' }, ref ? fmtDate(ref.date) : ''),
    ),
    el('div', { class: 'compare-bar', role: 'progressbar', 'aria-label': `${label} playback` }, fill),
    time,
  );
  return { label, ref, missingNote, row, fill, time, failed: false };
}

/**
 * The before and the after, played one after the other. The summit is the
 * feature the whole programme is walking toward, so when it isn't there yet
 * the view says how far along you are rather than hiding the row.
 */
export async function renderCompare(
  root: HTMLElement,
  pack: InstrumentPack,
  state: ProgressState,
  cb: CompareCallbacks,
  deps: CompareDeps = defaultDeps,
): Promise<Comparison> {
  const keys = await deps.listKeys();
  const comparison = selectComparison(pack, keys);
  const day = programDayFor(pack, state.startDate, today());
  const week = Math.min(Math.max(day.week, 1), pack.schedule.totalWeeks);
  const notYet = `not recorded yet, week ${week} of ${pack.schedule.totalWeeks}`;

  const baseline = trackRow(
    comparison.baselineDrill?.name ?? 'Day one',
    comparison.baseline,
    'not recorded yet — it runs in your first session with the microphone on',
  );
  const summit = trackRow(comparison.summitDrill?.name ?? 'Summit', comparison.summit, notYet);
  const tracks = [baseline, summit];
  const playable = tracks.filter((t) => t.ref !== null);

  const backBtn = el('button', { class: 'ghost' }, '← Back');
  backBtn.addEventListener('click', () => {
    stop();
    cb.onBack();
  });

  const playBtn = el(
    'button',
    { class: 'start-btn' },
    playable.length === 2 ? 'Play both, back to back' : playable.length === 1 ? `Play ${playable[0]!.label.toLowerCase()}` : 'Nothing to play yet',
  );
  if (playable.length === 0) playBtn.disabled = true;

  const nowPlaying = el('p', { class: 'sub compare-now' }, '');

  // One audio element, re-pointed at each track in turn. Object URLs are
  // revoked when playback stops or the view is left.
  const audio = document.createElement('audio');
  audio.preload = 'auto';
  let urls: string[] = [];
  let playing = false;
  let queue: Track[] = [];
  let currentTrack: Track | null = null;
  // Bumped on every stop and start, so a load that was in flight when the
  // user pressed Stop or Back finds itself stale when it resolves and
  // leaves the audio element alone.
  let generation = 0;

  const setActive = (track: Track | null) => {
    for (const t of tracks) t.row.classList.toggle('playing', t === track);
    currentTrack = track;
    nowPlaying.textContent = track ? `Playing ${track.label.toLowerCase()}` : '';
  };

  const stop = () => {
    playing = false;
    generation++;
    queue = [];
    audio.pause();
    audio.removeAttribute('src');
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    setActive(null);
    for (const t of tracks) {
      t.fill.style.width = '0%';
      // A failure note is the one thing worth keeping on screen after a stop.
      if (t.ref && !t.failed) t.time.textContent = '';
    }
    playBtn.textContent = playable.length === 2 ? 'Play both, back to back' : `Play ${playable[0]?.label.toLowerCase() ?? ''}`;
  };

  const playNext = async (): Promise<void> => {
    const next = queue.shift();
    if (!next || !next.ref) {
      stop();
      return;
    }
    const gen = generation;
    const stale = () => !playing || gen !== generation;
    const blob = await deps.load(next.ref.key);
    if (stale()) return;
    if (!blob) {
      next.failed = true;
      next.time.textContent = 'recording missing from storage';
      next.row.classList.add('missing');
      return playNext();
    }
    const url = URL.createObjectURL(blob);
    urls.push(url);
    setActive(next);
    audio.src = url;
    try {
      await audio.play();
    } catch {
      if (stale()) return;
      next.failed = true;
      next.time.textContent = 'could not play this recording';
      return playNext();
    }
  };

  audio.addEventListener('timeupdate', () => {
    const t = currentTrack;
    if (!t || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    t.fill.style.width = `${Math.min(100, (audio.currentTime / audio.duration) * 100)}%`;
    t.time.textContent = `${fmtClock(audio.currentTime)} / ${fmtClock(audio.duration)}`;
  });
  audio.addEventListener('ended', () => {
    const t = currentTrack;
    if (t) t.fill.style.width = '100%';
    void playNext();
  });

  playBtn.addEventListener('click', () => {
    if (playing) {
      stop();
      return;
    }
    playing = true;
    generation++;
    playBtn.textContent = 'Stop';
    for (const t of playable) {
      t.failed = false;
      t.time.textContent = '';
    }
    queue = [...playable];
    void playNext();
  });

  const screen = el(
    'div',
    { class: 'screen' },
    el('div', { class: 'wordmark' }, 'sustain'),
    el(
      'div',
      {},
      el('div', { class: 'eyebrow' }, 'day one · the summit'),
      el('h1', {}, 'Before and after'),
    ),
    el(
      'p',
      { class: 'sub' },
      `Thirty seconds from your first session, then thirty from week ${pack.schedule.totalWeeks}. ` +
        'The recordings never leave this browser.',
    ),
    el('div', { class: 'compare-tracks' }, baseline.row, summit.row),
    el('div', { class: 'stage compare-stage' }, playBtn, nowPlaying),
    backBtn,
  );

  root.replaceChildren(screen);
  return comparison;
}
