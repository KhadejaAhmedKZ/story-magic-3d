// The movie player: title card → 6 scenes (video or still) → end card.
// Clock = AudioContext time, so pausing the context pauses narration, music and timing together.
// Epilepsy-safe by design: long crossfades only, no cuts, slow camera motion, and a
// luminance guard that softens the picture if a clip ever changes brightness quickly.

import { CONFIG } from "./config.js";
import { Lullaby } from "./music.js";
import { pickBrowserVoice } from "./providers/voice.js";

export class Player {
  constructor(els, ctx) {
    this.els = els;            // { stage, layers:[a,b], captions, dots, playBtn, musicBtn }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.recDest = ctx.createMediaStreamDestination();
    this.master.connect(this.recDest);
    this.narrBus = ctx.createGain();
    this.narrBus.gain.value = 1.0;
    this.narrBus.connect(this.master);
    this.music = null;
    this.active = 0;           // which DOM layer is visible
    this.index = -1;
    this.playing = false;
    this.raf = null;
    this.guard = new FlashGuard(els.stage);
    this.listeners = {};
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  off(ev, fn) { this.listeners[ev] = (this.listeners[ev] || []).filter((f) => f !== fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

  load(movie) {
    this.movie = movie;
    this.items = movie.items;
    this.music?.stop(0.5);
    this.music = new Lullaby(this.ctx, this.master);
    this.buildDots();
    this.items.forEach((it) => {
      const narr = it.narration?.duration || 0;
      const clip = it.clipDuration || 0;
      const min = it.kind === "title" ? CONFIG.titleSeconds : it.kind === "end" ? CONFIG.endSeconds : 6;
      // scene timing = max(clip length, narration length + breathing room)
      it.duration = Math.max(min, clip, narr + 1.8);
    });
  }

  /** Show the title card (no sound) under the big play button. */
  preview() { this.startItem(0); this.stopNarration(); this.index = -1; }

  totalDuration() { return this.items.reduce((s, it) => s + it.duration, 0); }

  async play(from = 0) {
    if (this.ctx.state !== "running") await this.ctx.resume();
    this.playing = true;
    this.music.start();
    this.startItem(from);
    this.loop();
    this.updateButtons();
  }

  async togglePause() {
    if (this.index < 0) return this.play(0);
    if (this.playing) {
      this.playing = false;
      await this.ctx.suspend();
      this.currentVideo()?.pause();
      if (speechSynthesis.speaking) speechSynthesis.pause();
      this.els.stage.classList.add("paused");
    } else {
      this.playing = true;
      await this.ctx.resume();
      this.currentVideo()?.play().catch(() => {});
      if (speechSynthesis.paused) speechSynthesis.resume();
      this.els.stage.classList.remove("paused");
      this.loop();
    }
    this.updateButtons();
  }

  async replay() {
    this.stopNarration();
    if (this.ctx.state !== "running") await this.ctx.resume();
    this.els.stage.classList.remove("paused");
    this.music.stop(0.6);
    this.music = new Lullaby(this.ctx, this.master);
    this.music.setEnabled(this.musicOn !== false);
    this.play(0);
  }

  async jump(i) {
    this.stopNarration();
    if (!this.playing) {
      this.playing = true;
      await this.ctx.resume();
      this.els.stage.classList.remove("paused");
      this.music.start();
      this.loop();
    }
    this.startItem(i);
    this.updateButtons();
  }

  toggleMusic() {
    this.musicOn = this.musicOn === false;
    this.music?.setEnabled(this.musicOn);
    this.updateButtons();
  }

  stop() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopNarration();
    this.music?.stop(0.8);
    this.layers().forEach((l) => { l.querySelector("video")?.pause(); });
    this.guard.stop();
  }

  // ───────────────────────── internals ─────────────────────────
  layers() { return this.els.layers; }
  currentVideo() { return this.layers()[this.active].querySelector("video"); }

  startItem(i) {
    this.stopNarration();
    if (i >= this.items.length) return this.finish();
    this.index = i;
    const it = this.items[i];
    if (it.kind === "scene") {
      // a clip may have arrived late: recompute timing = max(clip, narration + breathing room)
      it.duration = Math.max(6, it.clipDuration || 0, (it.narration?.duration || 0) + 1.8);
    }
    const next = 1 - this.active;
    const incoming = this.layers()[next];
    const outgoing = this.layers()[this.active];

    incoming.innerHTML = "";
    incoming.style.setProperty("--dur", `${it.duration + 2}s`);
    incoming.className = "layer";
    let video = null;
    if (it.kind === "scene" && it.clip.type === "video") {
      video = document.createElement("video");
      video.src = it.clip.src;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      // slow the clip down (never below 0.5×) so it covers the narration; then hold last frame
      // never slower than 0.75× (keeps motion smooth); after the clip ends the last frame holds
      // while the layer keeps its slow drift-zoom, so the picture never freezes harshly
      const rate = it.clipDuration ? Math.max(0.75, Math.min(1, it.clipDuration / (it.duration - 0.4))) : 1;
      video.defaultPlaybackRate = rate;
      video.playbackRate = rate;
      incoming.appendChild(video);
      incoming.classList.add("drift");
      video.play().catch(() => {});
      this.guard.watch(video);
    } else if (it.kind === "scene") {
      const img = new Image();
      img.src = it.clip.src;
      img.alt = "";
      incoming.appendChild(img);
      incoming.classList.add("kenburns", `kb${i % 4}`);
      this.guard.stop();
    } else {
      incoming.appendChild(this.card(it));
      incoming.classList.add("cardlayer");
      this.guard.stop();
    }

    // crossfade (≥ 1 s, never a hard cut)
    requestAnimationFrame(() => {
      incoming.classList.add("show");
      outgoing.classList.remove("show");
    });
    const old = outgoing.querySelector("video");
    setTimeout(() => { if (old && outgoing !== this.layers()[this.active]) old.pause(); }, CONFIG.crossfadeMs + 200);
    this.active = next;

    this.itemStart = this.ctx.currentTime;
    this.narrStart = this.itemStart + 0.9;
    this.narrDone = !it.narration;
    this.narrStarted = false;
    this.renderCaption(it);
    this.markDot(i);
    this.emit("item", i, it);
  }

  card(it) {
    const d = document.createElement("div");
    d.className = `card ${it.kind}`;
    if (it.bg) d.style.setProperty("--bg", `url("${it.bg}")`);
    if (it.kind === "title") {
      d.innerHTML = `<div class="card-inner"><div class="card-emoji">✨📖✨</div>
        <h1></h1><p></p></div>`;
      d.querySelector("h1").textContent = this.movie.title;
      d.querySelector("p").textContent = `A story made just for ${this.movie.name}`;
    } else {
      d.innerHTML = `<div class="card-inner"><div class="card-emoji">🌙⭐</div>
        <h1>The End</h1><p></p></div>`;
      d.querySelector("p").textContent = `Goodnight, ${this.movie.name}!`;
    }
    return d;
  }

  startNarration(it) {
    this.narrStarted = true;
    const n = it.narration;
    if (!n) return;
    this.music.duck(true);
    if (n.kind === "buffer") {
      const src = this.ctx.createBufferSource();
      src.buffer = n.buffer;
      src.connect(this.narrBus);
      src.onended = () => { if (this.narrSrc === src) { this.narrDone = true; this.music.duck(false); } };
      src.start();
      this.narrSrc = src;
      this.narrDur = n.duration;
      this.narrT0 = this.ctx.currentTime;
    } else {
      const u = new SpeechSynthesisUtterance(n.text);
      const v = pickBrowserVoice(n.lang, n.female);
      if (v) u.voice = v;
      u.rate = 0.86; u.pitch = 1.05; u.volume = 1;
      u.onboundary = (e) => { if (e.name === "word" || e.charIndex != null) this.highlightChar(e.charIndex); };
      u.onend = () => { if (this.utt === u) { this.narrDone = true; this.music.duck(false); this.highlightChar(1e9); } };
      u.onerror = u.onend;
      this.utt = u;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
  }

  stopNarration() {
    if (this.narrSrc) { try { this.narrSrc.onended = null; this.narrSrc.stop(); } catch {} this.narrSrc = null; }
    if (this.utt) { this.utt.onend = null; this.utt = null; speechSynthesis.cancel(); }
    this.music?.duck(false);
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.playing) return;
      const it = this.items[this.index];
      if (!it) return;
      const t = this.ctx.currentTime;
      if (!this.narrStarted && t >= this.narrStart) this.startNarration(it);
      if (this.narrSrc && this.narrDur) {
        const words = it.narration?.words;
        if (words?.length && this.capWords?.length) {
          const el = t - this.narrT0;
          let k = 0;
          while (k + 1 < words.length && words[k + 1].t <= el) k++;
          this.setWord(Math.min(this.capWords.length - 1, Math.round((k / Math.max(1, words.length - 1)) * (this.capWords.length - 1))));
        } else {
          this.highlightProgress((t - this.narrT0) / this.narrDur);
        }
      }
      const elapsed = t - this.itemStart;
      this.emit("time", this.index, elapsed, it.duration);
      if (elapsed >= it.duration && this.narrDone) {
        this.startItem(this.index + 1);
      } else if (elapsed >= it.duration + 25) {
        this.narrDone = true; // safety: never get stuck
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  finish() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.music.stop(3);
    this.guard.stop();
    this.index = this.items.length;
    this.updateButtons();
    this.emit("ended");
  }

  // ───────── captions ─────────
  renderCaption(it) {
    const box = this.els.captions;
    box.innerHTML = "";
    this.capWords = [];
    if (it.kind !== "scene") { box.classList.remove("on"); return; }
    box.classList.add("on");
    const words = it.text.split(/(\s+)/);
    let pos = 0;
    let acc = 0;
    const total = it.text.replace(/\s+/g, "").length || 1;
    for (const w of words) {
      if (/^\s+$/.test(w)) { box.appendChild(document.createTextNode(" ")); pos += w.length; continue; }
      const s = document.createElement("span");
      s.textContent = w;
      box.appendChild(s);
      acc += w.length;
      this.capWords.push({ el: s, start: pos, end: pos + w.length, frac: acc / total });
      pos += w.length;
    }
    this.capIdx = -1;
  }
  highlightProgress(p) {
    if (!this.capWords?.length) return;
    let idx = this.capWords.findIndex((w) => w.frac >= p);
    if (idx < 0) idx = this.capWords.length - 1;
    this.setWord(idx);
  }
  highlightChar(ci) {
    if (!this.capWords?.length) return;
    let idx = this.capWords.findIndex((w) => ci < w.end);
    if (idx < 0) idx = this.capWords.length - 1;
    this.setWord(idx);
  }
  setWord(idx) {
    if (idx === this.capIdx) return;
    this.capIdx = idx;
    this.capWords.forEach((w, k) => {
      w.el.classList.toggle("said", k < idx);
      w.el.classList.toggle("now", k === idx);
    });
  }

  // ───────── UI bits ─────────
  buildDots() {
    const d = this.els.dots;
    d.innerHTML = "";
    this.items.forEach((it, i) => {
      const b = document.createElement("button");
      b.className = "dot";
      b.title = it.kind === "scene" ? `Scene ${it.n}` : it.kind === "title" ? "Title" : "The End";
      b.setAttribute("aria-label", b.title);
      b.textContent = it.kind === "title" ? "★" : it.kind === "end" ? "☾" : String(it.n);
      b.onclick = () => this.jump(i);
      d.appendChild(b);
    });
  }
  markDot(i) {
    [...this.els.dots.children].forEach((b, k) => b.classList.toggle("on", k === i));
  }
  updateButtons() {
    this.els.playBtn.textContent = this.playing ? "⏸️" : "▶️";
    this.els.playBtn.setAttribute("aria-label", this.playing ? "Pause" : "Play");
    this.els.musicBtn.textContent = this.musicOn === false ? "🔇" : "🎵";
  }
}

// ─────────────── Luminance flash guard (photosensitivity safety net) ───────────────
// Samples the playing clip ~10×/s. If brightness jumps sharply twice within one second
// (well under the 3-flashes-per-second limit), the stage is gently dimmed and softened.
class FlashGuard {
  constructor(stage) {
    this.stage = stage;
    this.c = document.createElement("canvas");
    this.c.width = 32; this.c.height = 18;
    this.g = this.c.getContext("2d", { willReadFrequently: true });
  }
  watch(video) {
    this.stop();
    this.video = video;
    this.last = null;
    this.events = [];
    this.timer = setInterval(() => this.sample(), 100);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  sample() {
    const v = this.video;
    if (!v || v.readyState < 2 || v.paused) return;
    let data;
    try {
      this.g.drawImage(v, 0, 0, 32, 18);
      data = this.g.getImageData(0, 0, 32, 18).data;
    } catch {
      this.stop(); // cross-origin clip without CORS: cannot inspect
      return;
    }
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const lum = sum / (data.length / 4) / 255;
    const now = performance.now();
    if (this.last != null && Math.abs(lum - this.last) > 0.1) {
      this.events.push(now);
      this.events = this.events.filter((t) => now - t < 1000);
      if (this.events.length >= 2) this.calm();
    }
    this.last = lum;
  }
  calm() {
    this.stage.classList.add("calm");
    clearTimeout(this.calmT);
    this.calmT = setTimeout(() => this.stage.classList.remove("calm"), 4000);
  }
}
