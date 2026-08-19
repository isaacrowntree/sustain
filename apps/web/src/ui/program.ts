import type { InstrumentPack, Phase, SessionSlot } from '@sustain/pack-sdk';
import {
  adherence,
  phaseProgress,
  programDayFor,
  unlockedDrills,
  type ProgressState,
} from '@sustain/core';
import { today } from '../state.js';
import { el } from './format.js';

const PHASE_CSS: Record<string, string> = {
  foundation: '#e8833a',
  'breath-mechanics': '#3fb8af',
  connection: '#a78bfa',
  'endurance-voice': '#7fb069',
};

const ROLE_LABEL: Record<SessionSlot['role'], string> = {
  warmup: 'warm-up',
  skill: 'skill',
  endurance: 'endurance',
  cooldown: 'cool-down',
};

export interface ProgramCallbacks {
  onBack(): void;
  onJumpToWeek(week: number): void;
}

function weekMinutes(phase: Phase, week: number): number {
  const t = phaseProgress(phase, week);
  const total = phase.sessionPlan.reduce((sum, slot) => {
    const m = typeof slot.minutes === 'number' ? slot.minutes : slot.minutes.start + (slot.minutes.end - slot.minutes.start) * t;
    return sum + m;
  }, 0);
  return Math.round(total);
}

/**
 * The whole sixteen weeks, laid open. Every drill you'll meet, when it
 * arrives, and what it's gated on — so the programme is something you can
 * read ahead in rather than a sequence of surprises.
 */
export function renderProgram(
  root: HTMLElement,
  pack: InstrumentPack,
  state: ProgressState,
  cb: ProgramCallbacks,
): void {
  const todayIso = today();
  const day = programDayFor(pack, state.startDate, todayIso);
  const unlocked = unlockedDrills(pack, state);
  const drillsById = new Map(pack.drills.map((d) => [d.id, d]));
  const a = adherence(pack, state, todayIso);
  const sessionsByWeek = new Map<number, number>();
  for (const w of a.weeks) {
    if (w.programWeek) sessionsByWeek.set(w.programWeek, w.sessionsDone);
  }

  const backBtn = el('button', { class: 'ghost' }, '← Back');
  backBtn.addEventListener('click', cb.onBack);

  const screen = el(
    'div',
    { class: 'screen' },
    el('div', { class: 'wordmark' }, 'sustain'),
    el(
      'div',
      {},
      el('div', { class: 'eyebrow' }, `${pack.schedule.totalWeeks} weeks · ${pack.schedule.daysPerWeek} sessions a week`),
      el('h1', {}, 'The programme'),
    ),
  );

  for (const phase of pack.phases) {
    const color = PHASE_CSS[phase.id] ?? '#e8833a';
    const section = el('div', { class: 'phase-card' });
    section.style.setProperty('--phase-c', color);

    section.append(
      el(
        'div',
        { class: 'phase-head' },
        el('h2', {}, phase.name),
        el('span', { class: 'phase-weeks' }, `weeks ${phase.weeks[0]}–${phase.weeks[1]}`),
      ),
      el('p', { class: 'sub' }, phase.focus),
    );

    // What you actually do, by role, with anything still gated marked.
    const slots = el('div', { class: 'slots' });
    for (const slot of phase.sessionPlan) {
      const names = slot.drills.map((id) => {
        const drill = drillsById.get(id);
        if (!drill) return id;
        const locked = !unlocked.has(id);
        const span = el('span', { class: locked ? 'drill locked' : 'drill' }, drill.name);
        if (drill.offInstrument) {
          span.append(el('sup', { class: 'off-mark', title: 'Done away from the instrument' }, '°'));
        }
        if (locked) span.title = 'Unlocks when you can do what comes before it';
        return span;
      });
      const row = el('div', { class: 'slot-row' }, el('span', { class: 'slot-role' }, ROLE_LABEL[slot.role]));
      const list = el('span', { class: 'slot-drills' });
      names.forEach((n, i) => {
        if (i > 0) list.append(document.createTextNode('  '));
        list.append(n);
      });
      row.append(list);
      slots.append(row);
    }
    section.append(slots);

    if (phase.bossAssessment) {
      section.append(
        el(
          'p',
          { class: 'boss-note' },
          `★ ${phase.bossAssessment.name} — ${phase.bossAssessment.description}`,
        ),
      );
    }

    // Week rows: length, where you are, and a way to move there.
    const weeks = el('div', { class: 'week-rows' });
    for (let w = phase.weeks[0]; w <= phase.weeks[1]; w++) {
      const isNow = w === day.week && !day.isComplete && day.dayIndex >= 0;
      const done = sessionsByWeek.get(w) ?? 0;
      const isBossWeek = w === phase.weeks[1] && Boolean(phase.bossAssessment);
      const row = el(
        'div',
        { class: isNow ? 'week-row now' : 'week-row' },
        el('span', { class: 'week-n' }, `week ${w}`),
        el('span', { class: 'week-len' }, `${weekMinutes(phase, w)} min${isBossWeek ? ' · ★' : ''}`),
        el(
          'span',
          { class: 'week-state' },
          isNow ? 'you are here' : done > 0 ? `${done}/${pack.schedule.daysPerWeek} done` : '',
        ),
      );
      if (!isNow) {
        const jump = el('button', { class: 'ghost jump' }, 'Jump here');
        jump.addEventListener('click', () => cb.onJumpToWeek(w));
        row.append(jump);
      }
      weeks.append(row);
    }
    section.append(weeks);
    screen.append(section);
  }

  screen.append(
    el(
      'p',
      { class: 'footer-note' },
      'Drills marked ° are done away from the instrument. Dimmed drills are still gated — they unlock when you demonstrate what comes before them. ' +
        'Jumping moves the whole programme so today lands in that week; sessions you have already done keep their place on the calendar.',
    ),
    backBtn,
  );

  root.replaceChildren(screen);
}
