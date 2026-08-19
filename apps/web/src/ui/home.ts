import type { InstrumentPack } from '@sustain/pack-sdk';
import {
  adherence,
  addDays,
  compileSession,
  completedDrillSet,
  drillsDoneOn,
  pendingFirstSessionDrills,
  mondayOf,
  programDayFor,
  unlockedDrills,
  type ISODate,
  type ProgressState,
} from '@sustain/core';
import { exportProgress, today } from '../state.js';
import { el, fmtMinutes } from './format.js';

const PHASE_CSS: Record<string, string> = {
  foundation: '#e8833a',
  'breath-mechanics': '#3fb8af',
  connection: '#a78bfa',
  'endurance-voice': '#7fb069',
};

export interface HomeCallbacks {
  onBegin(): void;
  onStartSession(): void;
}

export function renderWelcome(root: HTMLElement, pack: InstrumentPack, cb: HomeCallbacks): void {
  root.replaceChildren(
    el(
      'div',
      { class: 'screen' },
      el('div', { class: 'wordmark' }, 'sustain'),
      el(
        'div',
        { class: 'stage' },
        el('h1', {}, `${pack.schedule.totalWeeks} weeks of ${pack.name.toLowerCase()}`),
        el('p', { class: 'focus' }, pack.description),
        el(
          'p',
          { class: 'sub' },
          `${pack.schedule.daysPerWeek} sessions a week — rest days are part of the program. ` +
            'Progress is what you can actually do: longer drones, longer unbroken sound. No points.',
        ),
        (() => {
          const b = el('button', { class: 'start-btn' }, 'Begin week one');
          b.addEventListener('click', cb.onBegin);
          return b;
        })(),
      ),
      el(
        'p',
        { class: 'footer-note' },
        'Starting on a practice day joins this week; starting on a rest day begins Monday.',
      ),
    ),
  );
}

function weekStrip(pack: InstrumentPack, state: ProgressState, todayIso: ISODate): HTMLElement {
  const strip = el('div', { class: 'weekstrip' });
  const monday = mondayOf(todayIso);
  const done = new Set(state.sessions.map((s) => s.date));
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const isRest = i + 1 > pack.schedule.daysPerWeek;
    const cls = [
      'day',
      done.has(date) ? 'done' : '',
      isRest ? 'rest' : '',
      date === todayIso ? 'today' : '',
    ]
      .filter(Boolean)
      .join(' ');
    strip.append(el('div', { class: cls }, isRest && !done.has(date) ? '·' : labels[i]!));
  }
  return strip;
}

function journeyMap(pack: InstrumentPack, state: ProgressState): HTMLElement {
  const map = el('div', { class: 'journey' });
  const perWeek = new Map<number, number>();
  for (const s of state.sessions) {
    const wk = Math.floor(Math.max(0, s.dayIndex) / 7) + 1;
    perWeek.set(wk, (perWeek.get(wk) ?? 0) + 1);
  }
  for (let w = 1; w <= pack.schedule.totalWeeks; w++) {
    const phase = pack.phases.find((p) => w >= p.weeks[0] && w <= p.weeks[1]);
    const sessions = perWeek.get(w) ?? 0;
    const isBoss = phase?.weeks[1] === w && Boolean(phase.bossAssessment);
    const cls = ['wk', sessions >= pack.schedule.daysPerWeek ? '' : 'partial', isBoss ? 'boss' : '']
      .filter(Boolean)
      .join(' ');
    const wk = el('div', { class: cls, title: `Week ${w}${phase ? ` — ${phase.name}` : ''}` });
    // Bar height is the week's session count — the shape is the data.
    wk.style.height = `${8 + Math.min(sessions, pack.schedule.daysPerWeek) * 7}px`;
    if (sessions > 0) {
      const fill = el('div', { class: 'fill' });
      fill.style.setProperty('--phase-c', PHASE_CSS[phase?.id ?? ''] ?? '#e8833a');
      wk.append(fill);
    }
    map.append(wk);
  }
  return map;
}

export function renderHome(
  root: HTMLElement,
  pack: InstrumentPack,
  state: ProgressState,
  cb: HomeCallbacks,
): void {
  const todayIso = today();
  const day = programDayFor(pack, state.startDate, todayIso);
  const a = adherence(pack, state, todayIso);
  const doneDrills = drillsDoneOn(state, todayIso);
  const startedToday = doneDrills.size > 0;

  // What's left of today, after anything already finished in an earlier sitting.
  const remaining = day.phase
    ? compileSession(pack, day, unlockedDrills(pack, state), {
        firstSessionOfPhase: pendingFirstSessionDrills(state, day.phase).length > 0,
        completedDrills: completedDrillSet(state),
        makeup: day.isRestDay,
        skipDrills: doneDrills,
      })
    : null;
  const doneToday = startedToday && (!remaining || remaining.segments.length === 0);

  let action: HTMLElement;
  if (day.dayIndex < 0) {
    action = el(
      'div',
      { class: 'stage' },
      el('p', { class: 'focus' }, 'The program begins Monday. A good day to sort your instrument and your practice spot.'),
    );
  } else if (day.isComplete) {
    action = el(
      'div',
      { class: 'stage' },
      el('p', { class: 'focus' }, `Summit reached — ${pack.schedule.totalWeeks} weeks. Keep playing; maintenance is a few sessions a week.`),
    );
  } else if (doneToday) {
    // Practising twice is never the problem. The day still counts once.
    const againBtn = el('button', { class: 'secondary again' }, 'Practise again');
    againBtn.addEventListener('click', cb.onStartSession);
    const outstanding = day.phase ? pendingFirstSessionDrills(state, day.phase) : [];
    action = el(
      'div',
      { class: 'stage' },
      el(
        'p',
        { class: 'focus' },
        outstanding.length > 0
          ? 'Done for today — but the day-one recording is still outstanding. Run it again with the microphone on and it will be the first thing you do.'
          : 'Done for today. Tomorrow continues the arc.',
      ),
      againBtn,
    );
  } else if (day.isRestDay) {
    const thisWeek = a.weeks.find((w) => w.weekStart === mondayOf(todayIso));
    const behind = thisWeek && thisWeek.sessionsDone < thisWeek.target;
    if (behind) {
      const makeupBtn = el('button', { class: 'start-btn' }, 'Make-up session');
      makeupBtn.addEventListener('click', cb.onStartSession);
      action = el(
        'div',
        { class: 'stage' },
        el('p', { class: 'focus' }, 'Rest day — but this week is a session short. One make-up now keeps the week whole.'),
        makeupBtn,
      );
    } else {
      action = el(
        'div',
        { class: 'stage' },
        el('p', { class: 'focus' }, 'Rest day — scheduled and deliberate. Recovery is when the adaptation happens.'),
      );
    }
  } else {
    const btn = el(
      'button',
      { class: 'start-btn' },
      startedToday ? 'Continue session' : day.isBossSession ? 'Start assessment' : 'Start session',
    );
    btn.addEventListener('click', cb.onStartSession);
    action = el(
      'div',
      { class: 'stage' },
      el('p', { class: 'focus' }, day.phase?.focus ?? ''),
      el(
        'p',
        { class: 'sub' },
        remaining
          ? startedToday
            ? `${fmtMinutes(remaining.totalSeconds)} left of today — you've already done ${doneDrills.size === 1 ? 'one drill' : `${doneDrills.size} drills`}.`
            : `About ${fmtMinutes(remaining.totalSeconds)} today${day.isBossSession ? ' — assessment day' : ''}.`
          : '',
      ),
      btn,
    );
  }

  const streakWord = a.currentStreak === 1 ? 'perfect week' : 'perfect weeks';
  const sessionWord = a.totalSessions === 1 ? 'session' : 'sessions';
  const tally = el(
    'p',
    { class: 'tally' },
    `${a.currentStreak} ${streakWord} · ${a.totalSessions} ${sessionWord} · ${a.totalPlayMinutes} minutes played`,
  );

  const records = el('div', { class: 'records' });
  for (const m of pack.metrics) {
    const best = state.bests[m.id];
    records.append(
      el(
        'div',
        { class: 'rec' },
        el('div', { class: 'num' }, best ? `${best.value}s` : '—'),
        el('div', { class: 'lbl' }, m.name.toLowerCase()),
      ),
    );
  }

  const exportBtn = el('button', { class: 'ghost' }, 'Export progress JSON');
  exportBtn.addEventListener('click', () => {
    const url = exportProgress(state);
    const aEl = el('a', { href: url, download: `sustain-${pack.id}-progress.json` });
    document.body.append(aEl);
    aEl.click();
    aEl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  // The hero card carries the current phase's color.
  action.style.setProperty('--phase-c', PHASE_CSS[day.phase?.id ?? ''] ?? '#e8833a');

  root.replaceChildren(
    el(
      'div',
      { class: 'screen' },
      el('div', { class: 'wordmark' }, 'sustain'),
      el(
        'div',
        {},
        el('div', { class: 'eyebrow' }, `week ${Math.min(Math.max(day.week, 1), pack.schedule.totalWeeks)} of ${pack.schedule.totalWeeks}`),
        el('h1', {}, day.phase?.name ?? pack.name),
      ),
      action,
      el('div', { class: 'section' }, el('div', { class: 'eyebrow' }, 'this week'), weekStrip(pack, state, todayIso)),
      el('div', { class: 'section' }, el('div', { class: 'eyebrow' }, 'records'), records),
      el('div', { class: 'section' }, el('div', { class: 'eyebrow' }, 'the journey'), journeyMap(pack, state), tally),
      exportBtn,
    ),
  );
}
