// Original songs, written for GuitarSQUAT.
// chart patterns: rest | every4 | mix | every2 | holds | holdsLong
const SONGS_RAW = [
  {
    id: 'legday',
    title: 'Leg Day Anthem',
    blurb: 'A steady warm-up. Find the groove.',
    bpm: 92,
    chords: [
      { bass: 45, pad: [57, 60, 64] }, // Am
      { bass: 41, pad: [57, 60, 65] }, // F
      { bass: 48, pad: [55, 60, 64] }, // C
      { bass: 43, pad: [55, 59, 62] }, // G
    ],
    melodies: {
      A: [[0,76,4],[4,74,2],[6,72,2],[8,69,6],[14,72,2],[16,72,4],[20,74,2],[22,72,2],[24,69,4],[28,67,4],
          [32,67,4],[36,69,2],[38,72,2],[40,76,6],[46,74,2],[48,74,4],[52,72,2],[54,71,2],[56,67,8]],
      B: [[0,81,6],[6,79,2],[8,76,4],[12,79,4],[16,77,6],[22,76,2],[24,72,8],[32,76,4],[36,79,4],
          [40,84,6],[46,83,2],[48,79,8],[56,74,4],[60,71,4]],
    },
    sections: [
      { name: 'Intro', bars: 4, drums: 'intro', lead: null, chart: 'rest' },
      { name: 'Verse', bars: 8, drums: 'basic', lead: 'A', chart: 'every4' },
      { name: 'Chorus', bars: 8, drums: 'full', lead: 'B', chart: 'mix' },
      { name: 'Bridge', bars: 4, drums: 'half', lead: null, chart: 'holds' },
      { name: 'Verse 2', bars: 8, drums: 'basic', lead: 'A', chart: 'mix' },
      { name: 'Final Chorus', bars: 6, drums: 'full', lead: 'B', chart: 'every2' },
      { name: 'Outro', bars: 2, drums: 'end', lead: null, chart: 'rest' },
    ],
  },
  {
    id: 'quadinferno',
    title: 'Quad Inferno',
    blurb: 'Faster. Longer holds. Pure pain.',
    bpm: 116,
    chords: [
      { bass: 40, pad: [64, 67, 71] }, // Em
      { bass: 36, pad: [60, 64, 67] }, // C
      { bass: 43, pad: [62, 67, 71] }, // G
      { bass: 38, pad: [62, 66, 69] }, // D
    ],
    melodies: {
      A: [[0,76,2],[2,79,2],[4,83,2],[6,79,2],[8,76,2],[10,79,2],[12,81,4],
          [16,76,2],[18,79,2],[20,84,2],[22,79,2],[24,76,4],[28,74,4],
          [32,74,2],[34,79,2],[36,83,2],[38,79,2],[40,86,4],[44,83,4],
          [48,81,2],[50,78,2],[52,74,2],[54,78,2],[56,81,8]],
      B: [[0,88,8],[8,86,4],[12,83,4],[16,84,8],[24,83,4],[28,79,4],[32,83,8],[40,86,4],[44,88,4],[48,86,12],[60,81,4]],
    },
    sections: [
      { name: 'Intro', bars: 4, drums: 'intro', lead: null, chart: 'rest' },
      { name: 'Verse', bars: 8, drums: 'basic', lead: 'A', chart: 'every4' },
      { name: 'Build', bars: 4, drums: 'half', lead: null, chart: 'holds' },
      { name: 'Chorus', bars: 8, drums: 'full', lead: 'B', chart: 'mix' },
      { name: 'Breakdown', bars: 8, drums: 'half', lead: null, chart: 'holdsLong' },
      { name: 'Verse 2', bars: 8, drums: 'basic', lead: 'A', chart: 'mix' },
      { name: 'Final Chorus', bars: 8, drums: 'full', lead: 'B', chart: 'mix' },
      { name: 'Outro', bars: 2, drums: 'end', lead: null, chart: 'rest' },
    ],
  },
];

export const SONGS = SONGS_RAW.map((s) => {
  const bars = [];
  s.sections.forEach((sec, si) => { for (let i = 0; i < sec.bars; i++) bars.push({ sec: si, i }); });
  const beat = 60 / s.bpm;
  return { ...s, bars, totalBars: bars.length, beat, duration: bars.length * 4 * beat };
});

const TRANSFORM = {
  easy: { every2: 'every4', mix: 'every4' },
  normal: {},
  hard: { every4: 'mix', mix: 'every2' },
};

// Returns notes: {t, dur} in seconds from song start. dur = 0 for tap notes.
export function buildChart(song, difficulty) {
  const notes = [];
  const holdBeats = { easy: [2, 4], normal: [3, 6], hard: [3, 7] }[difficulty];
  let bar = 0;
  for (const sec of song.sections) {
    const pat = TRANSFORM[difficulty][sec.chart] || sec.chart;
    for (let i = 0; i < sec.bars; i++, bar++) {
      const add = (beat, dur = 0) => notes.push({ t: (bar * 4 + beat) * song.beat, dur: dur * song.beat });
      if (pat === 'every4') add(0);
      else if (pat === 'every2') { add(0); add(2); }
      else if (pat === 'mix') { if (i % 2 === 0) { add(0); add(2); } else add(0); }
      else if (pat === 'holds') { if (i % 2 === 0) add(0, holdBeats[0]); }
      else if (pat === 'holdsLong') { if (i % 4 === 0) add(0, holdBeats[1]); else if (i % 4 === 3) add(0); }
    }
  }
  // enforce a minimum gap so bodies can physically keep up
  const out = [];
  for (const n of notes) {
    const prev = out[out.length - 1];
    if (prev && n.t < prev.t + prev.dur + 0.95) continue;
    out.push(n);
  }
  return out;
}
