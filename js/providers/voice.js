// Voice providers: "proxy" (MiniMax speech-2.8 via the Worker — human-sounding, with word timings),
// "kokoro" (free, runs in the browser), "browser" (speechSynthesis, last resort).
// Fallback order is always: chosen provider → Kokoro → browser.
// speak() returns { kind: "buffer", buffer, duration, words? } or { kind: "speech", text, lang, duration }.

import { CONFIG } from "../config.js";
import { api } from "./api.js";

let worker = null;
let seq = 0;
const pending = new Map();
let kokoroBroken = false;
let onProgress = () => {};

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../kokoro-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "progress") return onProgress(m);
    if (m.type === "device") return console.info("[kokoro] running on", m.device);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.type === "error" ? p.reject(new Error(m.message)) : p.resolve(m);
  };
  worker.onerror = (e) => {
    console.warn("[kokoro] worker error", e.message);
    kokoroBroken = true;
    for (const p of pending.values()) p.reject(new Error("worker crashed"));
    pending.clear();
  };
  return worker;
}

function call(msg, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id, modelId: CONFIG.kokoro.modelId });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error("kokoro timeout")); }
    }, timeoutMs);
  });
}

/** Start downloading the Kokoro model early (≈90 MB once, then cached by the browser). */
export function warmUpVoice(progressCb) {
  if (progressCb) onProgress = progressCb;
  if (kokoroBroken) return Promise.resolve(false);
  return call({ type: "load" }, 240000).then(() => true).catch((e) => {
    console.warn("[kokoro] load failed:", e.message);
    kokoroBroken = true;
    return false;
  });
}

export async function speak(ctx, text, voice, token) {
  if (CONFIG.voiceProvider === "proxy" && token) {
    try {
      const r = await api("/api/tts", { body: { token, text, voice: voice.id }, timeoutMs: 40000 });
      const bytes = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
      const buf = await ctx.decodeAudioData(bytes.buffer);
      return { kind: "buffer", buffer: buf, duration: buf.duration, words: r.words || null, source: "minimax" };
    } catch (e) {
      console.warn("[voice] proxy tts failed:", e.code || "", e.message);
    }
  }
  if (CONFIG.voiceProvider !== "browser" && !kokoroBroken) {
    try {
      const m = await call({ type: "speak", text, voice: voice.kokoro, speed: CONFIG.kokoro.speed }, 120000);
      const buf = ctx.createBuffer(1, m.samples.length, m.sampleRate);
      buf.copyToChannel(m.samples, 0);
      return { kind: "buffer", buffer: buf, duration: buf.duration, source: "kokoro" };
    } catch (e) {
      console.warn("[voice] kokoro failed:", e.message);
    }
  }
  const words = text.split(/\s+/).length;
  return { kind: "speech", text, lang: voice.lang, female: voice.female, duration: words / 2.1 + 0.6, source: "browser" };
}

// ───────── browser speechSynthesis (used at playback time) ─────────
export function pickBrowserVoice(lang, female) {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith("en"));
  const pref = female
    ? ["Samantha", "Karen", "Moira", "Serena", "Google UK English Female", "Google US English", "Microsoft Aria", "Microsoft Jenny"]
    : ["Daniel", "Arthur", "Google UK English Male", "Microsoft Guy", "Alex", "Fred"];
  for (const n of pref) {
    const v = vs.find((x) => x.name.includes(n));
    if (v) return v;
  }
  return vs.find((v) => v.lang === lang) || vs[0] || null;
}
