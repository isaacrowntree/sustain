# Contributing to Sustain

Contributions are welcome — especially **instrument packs** and the **polyphonic analyzer**.

## Setup

```sh
pnpm install
pnpm test        # vitest across all packages
pnpm typecheck
pnpm dev         # web app
```

## Adding an instrument pack

A pack is data, validated by [`@sustain/pack-sdk`](packages/pack-sdk/src/types.ts). Copy the shape of [`packages/packs/didgeridoo`](packages/packs/didgeridoo) and fill in:

1. **Metrics** — what improving at this instrument *measurably* looks like (e.g. longest long tone, cents of pitch stability). Every metric needs a `measurement` mode: can the mic measure it (`auto`), does the player attest it (`self-report`), or `either`.
2. **Drills** — timed steps with spoken cues. Steps can accrue toward a metric. Gate drills with `requires`: a metric threshold, a completed prerequisite drill, or a self-report question.
3. **Phases** — contiguous week ranges with a session plan (warmup/skill/endurance/cooldown slots, each with a drill pool and a time budget that can ramp across the phase) and an optional boss assessment.
4. **Analyzer** — `timer`, `energy`, or `pitch` with the instrument's fundamental range. Monophonic instruments get verification for free via the existing pitch source.

Run `validatePack` in a test (see the didgeridoo pack's test) — it enforces referential integrity, contiguous weeks, and analyzer config.

**You don't need to be a programmer to design a pack.** Open an issue with the curriculum written out as text and someone can encode it.

## Help wanted

- **Polyphonic analyzer** (`packages/audio`): chord/strum detection for guitar-family packs — chromagram or lightweight-ML approaches welcome. The `PracticeSource` interface is the only contract.
- **Trombone pack**: long tones, Remington patterns, lip slurs. The pitch analyzer already reports Hz + clarity; a `cents`-unit stability metric would light up nicely.
- **Scene themes**: per-phase three.js environments (see `apps/web/src/scene`).
- **Accessibility**: the session HUD needs a reduced-motion mode and screen-reader pass.

## Ground rules

- TypeScript strict; keep packages dependency-light.
- All audio processing stays local. No telemetry, no accounts, no network calls with user data.
- Health framing: packs may cite evidence (as the didgeridoo pack does) but the app measures practice, not medical outcomes.
