// Synthesized music + SFX using Web Audio. No audio files needed.
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Synth {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.out.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.bus = null;
  }
  resume() { return this.ctx.resume(); }
  get dest() { return this.bus || this.out; }

  kick(t, v = 1) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(0.9 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(this.dest);
    o.start(t); o.stop(t + 0.45);
  }
  noise(t, dur, type, freq, q, vol, decay, dest = this.dest) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random()); s.stop(t + dur);
  }
  snare(t, v = 1) {
    this.noise(t, 0.25, 'bandpass', 1900, 0.7, 0.55 * v, 0.18);
    this.tone(t, 190, 0.09, 'triangle', 0.25 * v, 2000, 0.002, 0.07);
  }
  hat(t, v = 1, open = false) { this.noise(t, open ? 0.35 : 0.07, 'highpass', 8000, 1, 0.16 * v, open ? 0.3 : 0.045); }
  crash(t) { this.noise(t, 1.6, 'highpass', 4500, 0.5, 0.22, 1.4); }

  tone(t, freq, dur, type, vol, cutoff, attack = 0.005, release = 0.06, dest = this.dest) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass'; f.frequency.value = cutoff;
    const rel = Math.min(release, dur * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - rel));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f); f.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }
  bass(t, m, dur) {
    this.tone(t, mtof(m), dur, 'sawtooth', 0.2, 520, 0.005, 0.05);
    this.tone(t, mtof(m - 12), dur, 'sine', 0.22, 400, 0.005, 0.05);
  }
  lead(t, m, dur) {
    this.tone(t, mtof(m), dur, 'square', 0.055, 2800, 0.01, 0.06);
    this.tone(t, mtof(m) * 1.006, dur, 'sawtooth', 0.045, 3400, 0.01, 0.06);
  }
  pad(t, ms, dur, vol = 0.03) { ms.forEach((m) => this.tone(t, mtof(m), dur, 'triangle', vol, 1600, 0.25, 0.4)); }

  // SFX go straight to the output (not the song bus)
  blip(perfect) {
    const t = this.ctx.currentTime;
    this.tone(t, perfect ? 1568 : 1046, 0.09, 'sine', 0.12, 6000, 0.002, 0.06, this.out);
    if (perfect) this.tone(t + 0.05, 2093, 0.08, 'sine', 0.08, 6000, 0.002, 0.05, this.out);
  }
  thud() { const t = this.ctx.currentTime; this.tone(t, 98, 0.18, 'square', 0.07, 350, 0.002, 0.1, this.out); }
  tick(hi) { const t = this.ctx.currentTime; this.tone(t, hi ? 1760 : 880, 0.06, 'sine', 0.1, 6000, 0.002, 0.04, this.out); }

  playSong(song, t0) {
    const c = this.ctx, bus = c.createGain();
    bus.connect(this.out); this.bus = bus;
    const sd = 60 / song.bpm / 4;
    const total = song.totalBars * 16;
    let step = 0;
    const pump = () => {
      while (step < total && t0 + step * sd < c.currentTime + 0.25) {
        const prev = this.bus; this.bus = bus;
        this.scheduleStep(song, step, t0 + step * sd, sd);
        this.bus = prev;
        step++;
      }
    };
    pump();
    const id = setInterval(pump, 25);
    return {
      stop: () => {
        clearInterval(id);
        bus.gain.setTargetAtTime(0, c.currentTime, 0.05);
        setTimeout(() => bus.disconnect(), 600);
        if (this.bus === bus) this.bus = null;
      },
    };
  }

  scheduleStep(song, s, t, sd) {
    const bar = Math.floor(s / 16), p = s % 16;
    const info = song.bars[bar];
    const sec = song.sections[info.sec];
    const chord = song.chords[info.i % song.chords.length];
    const lastBar = info.i === sec.bars - 1;
    const kind = sec.drums;

    // drums
    if (kind === 'intro') {
      if (p % 4 === 0) this.hat(t, 0.8);
      if (p === 0 || p === 8) this.kick(t, 0.8);
      if (lastBar && p >= 12) this.snare(t, 0.4 + (p - 12) * 0.15);
    } else if (kind === 'basic') {
      if (p === 0 || p === 7 || p === 8) this.kick(t);
      if (p === 4 || p === 12) this.snare(t);
      if (p % 2 === 0) this.hat(t, 0.7);
      if (lastBar && p >= 13) this.snare(t, 0.6);
    } else if (kind === 'full') {
      if (p === 0 || p === 3 || p === 8 || p === 10) this.kick(t);
      if (p === 4 || p === 12) this.snare(t);
      this.hat(t, p % 2 === 0 ? 0.8 : 0.4, p === 14);
      if (info.i === 0 && p === 0) this.crash(t);
      if (lastBar && p >= 12) this.snare(t, 0.5 + (p - 12) * 0.12);
    } else if (kind === 'half') {
      if (p === 0) this.kick(t);
      if (p === 8) this.snare(t);
      if (p % 4 === 0) this.hat(t, 0.6);
      if (lastBar && p >= 12) this.snare(t, 0.5);
    } else if (kind === 'end') {
      if (p === 0 && info.i === 0) { this.kick(t); this.crash(t); }
    }

    // bass
    if (kind === 'intro') { if (p === 0 || p === 8) this.bass(t, chord.bass, sd * 7.5); }
    else if (kind === 'basic') { if (p % 2 === 0) this.bass(t, chord.bass, sd * 1.7); }
    else if (kind === 'full') { if (p % 2 === 0) this.bass(t, chord.bass + (p % 4 === 2 ? 12 : 0), sd * 1.7); }
    else if (kind === 'half') { if (p === 0) this.bass(t, chord.bass, sd * 15); }
    else if (kind === 'end') { if (p === 0 && info.i === 0) this.bass(t, chord.bass, sd * 24); }

    // pad
    if (p === 0) {
      if (kind === 'end') { if (info.i === 0) this.pad(t, chord.pad, sd * 28, 0.04); }
      else this.pad(t, chord.pad, sd * 16, kind === 'full' ? 0.02 : 0.032);
    }

    // lead
    if (sec.lead) {
      const phrase = song.melodies[sec.lead];
      const ps = (info.i % 4) * 16 + p;
      for (const n of phrase) if (n[0] === ps) this.lead(t, n[1], n[2] * sd * 0.92);
    }
  }
}
