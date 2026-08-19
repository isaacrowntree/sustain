import type { InstrumentPack } from '@sustain/pack-sdk';
import {
  adherence,
  addDays,
  compileSession,
  hasSessionInPhase,
  mondayOf,
  programDayFor,
  unlockedDrills,
  type ISODate,
  type ProgressState,
} from '@sustain/core';
import { exportProgress, today } from '../state.js';
import { el, fmtMinutes } from './format.js';

const PHASE_CSS: Record<string, string> = {
  foundation: '#f5a643',
  'breath-mechanics': '#4ecdc4',
  connection: '#b58cff',
  'endurance-voice': '#6fce8f',
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
      el('h1', {}, 'Sustain'),
      el(
        'div',
        { class: 'card hero' },
        el('h2', {}, `${pack.name}: ${pack.schedule.totalWeeks} weeks`),
        el('p', { class: 'sub' }, pack.description),
        el(
          'p',
          { class: 'sub' },
          `${pack.schedule.daysPerWeek} sessions a week. Rest days are part of the program. ` +
            'Progress is measured in what you can actually do — longer drones, longer unbroken sound — not points.',
        ),
        (() => {
          const b = el('button', {}, 'Begin week 1');
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
    if (sessions > 0) {
      const fill = el('div', { class: 'fill' });
      fill.style.setProperty('--phase-c', PHASE_CSS[phase?.id ?? ''] ?? '#f5a643');
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
  const doneToday = state.sessions.some((s) => s.date === todayIso);

  let action: HTMLElement;
  if (day.dayIndex < 0) {
    action = el(
      'div',
      { class: 'card hero' },
      el('h2', {}, 'Program begins Monday'),
      el('p', { class: 'sub' }, 'Week 1 starts fresh. A good day to sort your instrument and your practice spot.'),
    );
  } else if (day.isComplete) {
    action = el(
      'div',
      { class: 'card hero' },
      el('h2', {}, 'Summit reached'),
      el('p', { class: 'sub' }, `${pack.schedule.totalWeeks} weeks done. Keep playing — maintenance is a few sessions a week.`),
    );
  } else if (doneToday) {
    action = el(
      'div',
      { class: 'card hero' },
      el('h2', {}, 'Done for today'),
      el('p', { class: 'sub' }, 'Session complete. Tomorrow continues the arc.'),
    );
  } else if (day.isRestDay) {
    action = el(
      'div',
      { class: 'card hero' },
      el('h2', {}, 'Rest day'),
      el('p', { class: 'sub' }, 'Scheduled and deliberate — recovery is when the adaptation happens. See you Monday.'),
    );
  } else {
    const session = compileSession(pack, day, unlockedDrills(pack, state), {
      firstSessionOfPhase: day.phase ? !hasSessionInPhase(state, day.phase) : false,
    });
    const btn = el('button', {}, day.isBossSession ? 'Start assessment' : 'Start session');
    btn.addEventListener('click', cb.onStartSession);
    action = el(
      'div',
      { class: 'card hero' },
      el('h2', {}, session?.title ?? 'Session'),
      el('p', { class: 'sub' }, day.phase?.focus ?? ''),
      el('p', { class: 'sub' }, session ? `About ${fmtMinutes(session.totalSeconds)}.` : ''),
      btn,
    );
  }

  const stats = el(
    'div',
    { class: 'stat-row' },
    el('div', { class: 'stat' }, el('div', { class: 'v' }, String(a.currentStreak)), el('div', { class: 'l' }, 'perfect weeks')),
    el('div', { class: 'stat' }, el('div', { class: 'v' }, String(a.totalSessions)), el('div', { class: 'l' }, 'sessions')),
    el('div', { class: 'stat' }, el('div', { class: 'v' }, String(a.totalPlayMinutes)), el('div', { class: 'l' }, 'played min')),
  );

  const prCard = el('div', { class: 'card' }, el('h2', {}, 'Personal records'));
  const prRow = el('div', { class: 'stat-row' });
  for (const m of pack.metrics) {
    const best = state.bests[m.id];
    prRow.append(
      el(
        'div',
        { class: 'stat pr' },
        el('div', { class: 'v' }, best ? `${best.value}s` : '—'),
        el('div', { class: 'l' }, m.name),
      ),
    );
  }
  prCard.append(prRow);

  const exportBtn = el('button', { class: 'ghost' }, 'Export progress JSON');
  exportBtn.addEventListener('click', () => {
    const url = exportProgress(state);
    const aEl = el('a', { href: url, download: `sustain-${pack.id}-progress.json` });
    document.body.append(aEl);
    aEl.click();
    aEl.remove();
  });

  root.replaceChildren(
    el(
      'div',
      { class: 'screen' },
      el('h1', {}, `Week ${Math.min(Math.max(day.week, 1), pack.schedule.totalWeeks)} · ${day.phase?.name ?? pack.name}`),
      action,
      el('div', { class: 'card' }, el('h2', {}, 'This week'), weekStrip(pack, state, todayIso)),
      prCard,
      el('div', { class: 'card' }, el('h2', {}, `The ${pack.schedule.totalWeeks}-week journey`), journeyMap(pack, state), stats),
      exportBtn,
    ),
  );
}
