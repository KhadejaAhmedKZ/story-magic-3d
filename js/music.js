// Gentle generated lullaby — a NEW piece every story (random key, tempo, chords, melody).
// Soft attacks only, low volume, no percussion. Ducks under the narrator.

const SCALES = {
  majorPent: [0, 2, 4, 7, 9],
  lydianPent: [0, 2, 4, 6, 9],
  mixoPent: [0, 2, 5, 7, 9],
};
const PROGS = [
  [0, 5, 3, 4], [0, 3, 4, 3], [0, 4, 5, 3], [0, 5, 1, 4], [0, 3, 0, 4],
];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export class Lullaby {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    this.enabled = true;
    this.base = 0.55;
    this.duckLevel = 0.22;
    this.timer = null;

    // soft generated reverb
    this.verb = ctx.createConvolver();
    this.verb.buffer = makeImpulse(ctx, 3.2);
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    this.verb.connect(wet).connect(this.out);
    this.dry = ctx.createGain(); this.dry.gain.value = 0.7;
    this.dry.connect(this.out);
    this.bus = ctx.createGain();
    this.bus.connect(this.dry);
    this.bus.connect(this.verb);
    this.randomize();
  }

  randomize() {
    const keys = Object.keys(SCALES);
    this.scale = SCALES[keys[Math.floor(Math.random() * keys.length)]];
    this.root = 55 + Math.floor(Math.random() * 8);       // MIDI F3..C4
    this.bpm = 58 + Math.floor(Math.random() * 14);
    this.prog = PROGS[Math.floor(Math.random() * PROGS.length)];
    this.beat = 0;
  }

  start() {
    if (this.timer) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 100);
    this.fadeTo(this.enabled ? this.base : 0, 2.5);
  }

  stop(fade = 2) {
    this.fadeTo(0, fade);
    const t = this.timer; this.timer = null;
    setTimeout(() => clearInterval(t), fade * 1000 + 100);
  }

  setEnabled(on) { this.enabled = on; this.fadeTo(on ? this.current() : 0, 0.8); }
  duck(on) { this.ducked = on; if (this.enabled) this.fadeTo(this.current(), on ? 0.6 : 1.4); }
  current() { return this.ducked ? this.duckLevel : this.base; }

  fadeTo(v, secs) {
    const g = this.out.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(v, t + secs);
  }

  schedule() {
    const spb = 60 / this.bpm;
    while (this.next < this.ctx.currentTime + 0.5) {
      const t = this.next;
      const bar = Math.floor(this.beat / 4);
      const inBar = this.beat % 4;
      const degree = this.prog[bar % this.prog.length];
      if (inBar === 0) this.pad(t, degree, spb * 4);
      if (inBar === 0 || inBar === 2) this.bass(t, degree, spb * 2);
      // music-box melody, sparse and random
      if (Math.random() < 0.62) this.bell(t, this.melodyNote(degree), spb * 1.6);
      if (Math.random() < 0.18) this.bell(t + spb / 2, this.melodyNote(degree), spb);
      this.beat++;
      this.next += spb;
    }
  }

  chordTone(degree, k) {
    const idx = degree + k * 2;
    return this.root + MAJOR[idx % 7] + 12 * Math.floor(idx / 7);
  }
  melodyNote(degree) {
    const s = this.scale;
    const n = s[Math.floor(Math.random() * s.length)];
    const octave = Math.random() < 0.3 ? 24 : 12;
    // prefer chord tones a bit
    if (Math.random() < 0.45) return this.chordTone(degree, Math.floor(Math.random() * 3)) + 12;
    return this.root + n + octave;
  }

  pad(t, degree, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 900;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0.0, t + dur * 1.05);
    f.connect(g).connect(this.bus);
    for (let k = 0; k < 3; k++) {
      const o = ctx.createOscillator();
      o.type = k === 1 ? "triangle" : "sine";
      o.frequency.value = mtof(this.chordTone(degree, k));
      o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(f);
      o.start(t); o.stop(t + dur * 1.1);
    }
  }

  bass(t, degree, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = mtof(this.chordTone(degree, 0) - 12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + dur + 0.1);
  }

  bell(t, midi, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur + 1.2);
    g.connect(this.bus);
    [[1, 1], [2.01, 0.25], [3.98, 0.08]].forEach(([mult, amp]) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = "sine";
      o.frequency.value = mtof(midi) * mult;
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + dur + 1.3);
    });
  }
}

function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function makeImpulse(ctx, secs) {
  const len = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}
