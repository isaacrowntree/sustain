# Sustain

**A deliberate-practice engine for musical instruments.** Guided daily sessions, progress measured in what you can actually do, inside an audio-reactive three.js environment that only comes alive while you play.

No points. No levels. No streak anxiety. The progression *is* the curriculum: drills unlock when you demonstrate their prerequisites, records are real measurements (longest drone, longest unbroken sound), and adherence is counted in **perfect weeks** — with rest days scheduled into the program, never counted against you.

> **Status: early.** The engine, the didgeridoo pack, and the web app work end-to-end. Expect sharp edges.

## How it works

- **Instrument packs** are mostly data: metrics, a declarative curriculum (phases → drills → prerequisites), and an analyzer spec. Teachers can write packs without writing an app. See [`packages/pack-sdk`](packages/pack-sdk).
- **The engine** ([`packages/core`](packages/core)) compiles a pack + a calendar date into today's session: warmup → skill → endurance → cooldown, ramping session length across each phase, with measured **assessments** at phase boundaries.
- **The audio pipeline** ([`packages/audio`](packages/audio)) is tiered. Sessions run fine with no microphone at all (honor-system timer). Grant the mic and the world reacts to your sound; for monophonic instruments the McLeod Pitch Method verifies you're actually playing — credited minutes and auto-measured records, all processed locally in the browser. Nothing is uploaded, anywhere.
- **The web app** ([`apps/web`](apps/web)) renders the session as a lane flowing toward you — long-tone segments are sustain bars you ride — and stores all progress in your browser (exportable JSON).

## Instruments

| Pack | Status |
| --- | --- |
| Didgeridoo | ✅ First pack: 16 weeks from first drone to sustained circular breathing |
| Trombone | 🔜 Long tones, slurs, and range — the pitch analyzer already supports it |
| Guitar | 🙏 Needs a polyphonic analyzer ([help wanted](CONTRIBUTING.md)) |

## Why a didgeridoo pack first?

Because of a wonderfully real piece of science: a randomized controlled trial ([Puhan et al., BMJ 2006](https://pmc.ncbi.nlm.nih.gov/articles/PMC1360393/)) found that ~25 minutes of didgeridoo practice on ~6 days a week for four months roughly halved participants' apnoea–hypopnoea index and significantly reduced snoring and daytime sleepiness. It won the 2017 Ig Nobel Peace Prize, and it's the reason this project exists.

If that's why you're here: **the practice is the treatment.** Sustain doesn't track your snoring — it gets you to practice, and the didgeridoo pack follows the trial's protocol (drone holds, circular breathing, lip/vocal-tract work, ≥5 days a week, 16 weeks). A cheap PVC didgeridoo is fine; the trial itself used plastic instruments. Better sleep, if it comes, arrives as a symptom of learning.

## Running it

```sh
pnpm install
pnpm dev        # web app on http://localhost:5173
pnpm test       # engine + pack tests
pnpm build
```

## Design principles

1. **Progression is the curriculum.** Unlock by demonstration, not by grinding a counter.
2. **Measure, don't decorate.** Every number shown is a real measurement of skill or adherence.
3. **Rest is part of the program.** Perfect weeks, not daily streaks. One missed day genuinely doesn't matter — [the habit research says so](https://onlinelibrary.wiley.com/doi/10.1002/ejsp.674).
4. **Local-first.** Your practice data and recordings live in your browser and export as JSON.
5. **Packs are data.** If you can teach it as a progression of drills, you can encode it.

## License

[MIT](LICENSE)
