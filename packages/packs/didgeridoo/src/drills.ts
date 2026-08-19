import type { Drill } from '@sustain/pack-sdk';

/**
 * Drill content follows the progression used in the Puhan et al. BMJ 2006
 * trial (drone hold → circular breathing → lip/vocal-tract interaction) and
 * the widely taught circular-breathing drill ladder (cheek isolation →
 * water-spray → straw-and-glass → squeeze-sniff → on the instrument).
 */
export const drills: Drill[] = [
  // ---- Foundation / warmups ----
  {
    id: 'posture-breath',
    name: 'Posture & belly breathing',
    description: 'Diaphragmatic breathing to open the session. Sit tall, didge resting, one hand on your belly.',
    goal: 'Slow, low breaths that move your hand, not your shoulders.',
    offInstrument: true,
    steps: [
      { kind: 'instruction', seconds: 10, cue: 'Sit tall. One hand on your belly.' },
      { kind: 'play', seconds: 50, cue: 'Breathe low and slow — belly rises, shoulders still.' },
      { kind: 'rest', seconds: 10, cue: 'Shake out. Loosen your jaw.' },
      { kind: 'play', seconds: 50, cue: 'Again — in through the nose, long sigh out.' },
    ],
  },
  {
    id: 'lip-flutter',
    name: 'Loose-lip flutter',
    description: 'Horse-flutter lip conditioning. The didge embouchure is far looser than any brass embouchure — this drill is where trombone tension gets unlearned.',
    goal: 'A big, sloppy, effortless flutter. If it sounds refined, it is too tight.',
    offInstrument: true,
    steps: [
      { kind: 'play', seconds: 30, cue: 'Flutter your lips like a horse — big and loose.' },
      { kind: 'rest', seconds: 15, cue: 'Rest. No firm corners — let the whole face go slack.' },
      { kind: 'play', seconds: 30, cue: 'Again, even looser. Floppy beats focused.' },
      { kind: 'rest', seconds: 15, cue: 'Rest.' },
    ],
  },
  {
    id: 'first-drone',
    name: 'Finding the drone',
    description: 'Gentle raspberry into the didge. Soft lip seal on the rim, near-zero pressure, small controlled air release.',
    goal: 'A full, buzzing drone that appears without force.',
    steps: [
      { kind: 'instruction', seconds: 15, cue: 'Soft seal on the rim. Loose lips. Gentle air.', detail: 'Blowing harder makes it worse, not better. Think warm slow air.' },
      { kind: 'play', seconds: 20, cue: 'Drone — gentle raspberry, let it buzz.', metric: 'longest-drone' },
      { kind: 'rest', seconds: 20, cue: 'Rest. Drop the jaw, breathe.' },
      { kind: 'play', seconds: 20, cue: 'Drone again — same softness, steadier.', metric: 'longest-drone' },
      { kind: 'rest', seconds: 20, cue: 'Rest.' },
    ],
  },
  {
    id: 'baseline-recording',
    name: 'Day-one recording',
    description: 'Capture 30 seconds of your best playing right now. At the summit, day 120 plays back-to-back against this.',
    steps: [
      { kind: 'instruction', seconds: 10, cue: 'Recording next — play your best drone, however it sounds.' },
      { kind: 'record', seconds: 30, cue: 'Recording. Future you wants this.' },
    ],
  },
  {
    id: 'drone-holds',
    name: 'Drone holds',
    description: 'Extend a single-breath drone. The trial technique: produce and hold the keynote 20–30 seconds.',
    goal: 'Longer, steadier holds each week — measured, not guessed.',
    steps: [
      { kind: 'play', seconds: 30, cue: 'One breath — hold the drone as long as it lasts.', metric: 'longest-drone' },
      { kind: 'rest', seconds: 20, cue: 'Recover. Loose jaw, low breath.' },
      { kind: 'play', seconds: 30, cue: 'Again. Steady volume beats loud.', metric: 'longest-drone' },
      { kind: 'rest', seconds: 20, cue: 'Recover.' },
    ],
  },
  {
    id: 'soft-landing',
    name: 'Soft landing',
    description: 'Quiet drones and slow breathing to close the session.',
    offInstrument: false,
    steps: [
      { kind: 'play', seconds: 40, cue: 'Quietest drone you can make. Barely there.' },
      { kind: 'rest', seconds: 20, cue: 'Sit for a moment. Notice your throat and jaw.' },
    ],
  },

  // ---- Breath mechanics (mostly off-instrument) ----
  {
    id: 'cheek-puff-breathing',
    name: 'Cheek isolation',
    description: 'Hold your cheeks fully puffed while breathing normally through the nose. Cheeks and lungs become independent systems.',
    goal: 'Puffed cheeks feel neutral — you forget they are holding air.',
    offInstrument: true,
    steps: [
      { kind: 'play', seconds: 45, cue: 'Puff your cheeks. Breathe through your nose. Keep them puffed.' },
      { kind: 'rest', seconds: 15, cue: 'Release. Massage your cheeks.' },
      { kind: 'play', seconds: 45, cue: 'Again — cheeks full, breath easy.' },
      { kind: 'rest', seconds: 15, cue: 'Release.' },
    ],
  },
  {
    id: 'water-spray',
    name: 'Water-spray drill',
    description: 'Mouth full of water, cheeks bulging: squeeze out a thin steady stream while sniffing in through the nose. Do this over a sink.',
    goal: 'The stream does not stutter when you sniff.',
    offInstrument: true,
    requires: [{ kind: 'drill-completed', drill: 'cheek-puff-breathing', times: 3 }],
    steps: [
      { kind: 'instruction', seconds: 15, cue: 'At the sink. Mouth full of water, cheeks bulging.' },
      { kind: 'play', seconds: 30, cue: 'Squeeze a thin stream — and sniff in while it flows.' },
      { kind: 'rest', seconds: 15, cue: 'Refill. Shake out your jaw.' },
      { kind: 'play', seconds: 30, cue: 'Again. Steady stream, quick sniffs.' },
      { kind: 'rest', seconds: 15, cue: 'Done — towel off.' },
    ],
  },
  {
    id: 'straw-glass',
    name: 'Straw & glass',
    description: 'Blow bubbles through a straw into a glass of water. Keep the bubble stream unbroken while sniffing in through the nose — visual proof of circular breathing.',
    goal: 'Sixty seconds of unbroken bubbles.',
    offInstrument: true,
    requires: [{ kind: 'drill-completed', drill: 'water-spray', times: 2 }],
    steps: [
      { kind: 'play', seconds: 45, cue: 'Bubble stream going — keep it alive through the sniff.' },
      { kind: 'rest', seconds: 15, cue: 'Rest. Watch for where the stream broke.' },
      { kind: 'play', seconds: 45, cue: 'Again — smaller cheek squeeze, earlier sniff.' },
      { kind: 'rest', seconds: 15, cue: 'Rest.' },
    ],
  },
  {
    id: 'squeeze-sniff',
    name: 'Squeeze & sniff',
    description: 'The key coordination, dry: squeeze cheek air out (jaw rises, cheeks tighten) at the exact moment of a nose sniff, then re-pressurise with a diaphragm push. Loop it rhythmically.',
    goal: 'The squeeze-sniff-push loop runs on rails without thinking.',
    offInstrument: true,
    requires: [{ kind: 'drill-completed', drill: 'water-spray', times: 2 }],
    steps: [
      { kind: 'play', seconds: 40, cue: 'Squeeze out — sniff in — push. Loop it slowly.' },
      { kind: 'rest', seconds: 15, cue: 'Rest.' },
      { kind: 'play', seconds: 40, cue: 'Again, to a steady count: squeeze, sniff, push.' },
      { kind: 'rest', seconds: 15, cue: 'Rest.' },
    ],
  },

  // ---- Connection: circular breathing on the instrument ----
  {
    id: 'cb-on-didge',
    name: 'Circular breathing on the didge',
    description: 'The squeeze-sniff loop, on the drone. The drone will dip or growl through the squeeze at first — that is progress, not failure.',
    goal: 'Any sound bridging the breath, however ugly.',
    requires: [
      { kind: 'drill-completed', drill: 'straw-glass', times: 3 },
      { kind: 'self-report', id: 'can-squeeze-sniff', prompt: 'Can you keep the straw bubbles unbroken through a sniff?' },
    ],
    steps: [
      { kind: 'play', seconds: 45, cue: 'Drone, then: squeeze — sniff — push. Bridge it.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 25, cue: 'Rest. The dip in sound is normal. Shrink it later.' },
      { kind: 'play', seconds: 45, cue: 'Again. Keep the cheeks doing the work.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 25, cue: 'Rest.' },
    ],
  },
  {
    id: 'bridge-the-gap',
    name: 'Bridge the gap',
    description: 'Shrink the wobble where the breath happens: smaller squeeze, earlier sniff, smoother handover back to lung air.',
    goal: 'The join gets quieter every week until a listener cannot find it.',
    requires: [{ kind: 'drill-completed', drill: 'cb-on-didge', times: 2 }],
    steps: [
      { kind: 'play', seconds: 60, cue: 'Drone with breath bridges — make each join smaller.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 20, cue: 'Rest. Where did the last join leak?' },
      { kind: 'play', seconds: 60, cue: 'Again — sniff earlier, before you are empty.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 20, cue: 'Rest.' },
    ],
  },
  {
    id: 'endurance-drone',
    name: 'Endurance drone',
    description: 'Long continuous sets. Breaks are fine — restart and keep the total time on the instrument high.',
    goal: 'More unbroken seconds per set, week over week.',
    steps: [
      { kind: 'play', seconds: 120, cue: 'Long set. Settle in — steady, relaxed drone.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 30, cue: 'Recover. Drop the shoulders.' },
    ],
  },

  // ---- Endurance & voice ----
  {
    id: 'unbroken-sets',
    name: 'Unbroken sets',
    description: 'Circular-breathed sets with a target: keep the sound alive for the whole set.',
    goal: 'Whole sets with zero silent gaps.',
    requires: [{ kind: 'metric', metric: 'longest-unbroken', gte: 60 }],
    steps: [
      { kind: 'play', seconds: 180, cue: 'One unbroken set. Sound alive the whole way.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 40, cue: 'Recover fully.' },
    ],
  },
  {
    id: 'rhythm-pulses',
    name: 'Rhythm pulses',
    description: 'Tongue and diaphragm accents over the drone — "ta" and "ka" pulses, then belly-push accents. This is the lip/vocal-tract interaction work from the trial protocol.',
    goal: 'A groove you can hold without losing the drone.',
    steps: [
      { kind: 'play', seconds: 60, cue: 'Drone with tongue pulses — ta, ta, ta.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 20, cue: 'Rest.' },
      { kind: 'play', seconds: 60, cue: 'Now belly accents — push the pulse from the diaphragm.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 20, cue: 'Rest.' },
    ],
  },
  {
    id: 'vocal-drone',
    name: 'Voice over drone',
    description: 'Sing, hum, and growl into the drone. Vocal-tract work over the standing wave — and it sounds fantastic.',
    goal: 'Voice and drone as two independent layers.',
    steps: [
      { kind: 'play', seconds: 60, cue: 'Drone, then add a hum on top. Slide it around.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 20, cue: 'Rest.' },
      { kind: 'play', seconds: 60, cue: 'Try a growl, a call, a vowel shift — play with it.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 20, cue: 'Rest.' },
    ],
  },
  {
    id: 'toots',
    name: 'Toots',
    description: 'The overtone trumpet note — momentarily tighter lips, more air speed. The one didge skill that works like brass playing.',
    goal: 'A clean toot on demand, returning to the drone without a crash.',
    steps: [
      { kind: 'play', seconds: 45, cue: 'Drone… then pop a toot. Back to the drone.' },
      { kind: 'rest', seconds: 20, cue: 'Rest. Loosen back up — toot tension must not linger.' },
      { kind: 'play', seconds: 45, cue: 'Again — drone, toot, drone. Smooth transitions.' },
      { kind: 'rest', seconds: 20, cue: 'Rest.' },
    ],
  },
  {
    id: 'freeplay',
    name: 'Free play',
    description: 'No instructions. Combine everything — rhythm, voice, toots — and just play.',
    steps: [
      { kind: 'play', seconds: 180, cue: 'Yours. Play whatever you like.', metric: 'longest-unbroken' },
      { kind: 'rest', seconds: 30, cue: 'Breathe.' },
    ],
  },
  {
    id: 'summit-recording',
    name: 'Summit recording',
    description: 'Thirty seconds of your best playing, recorded to sit beside day one.',
    steps: [
      { kind: 'instruction', seconds: 10, cue: 'Final recording. Play it like a performance.' },
      { kind: 'record', seconds: 30, cue: 'Recording — this is the after picture.' },
    ],
  },
];
