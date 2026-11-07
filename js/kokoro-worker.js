// Runs Kokoro-82M TTS fully in the browser (no key, no server), off the main thread.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";

let tts = null;
let loading = null;

async function load(modelId) {
  if (tts) return tts;
  if (loading) return loading;
  const webgpu = !!(self.navigator && self.navigator.gpu);
  const tryLoad = (device, dtype) =>
    KokoroTTS.from_pretrained(modelId, {
      dtype,
      device,
      progress_callback: (p) => {
        if (p.status === "progress" && p.total) {
          self.postMessage({ type: "progress", loaded: p.loaded, total: p.total, file: p.file });
        }
      },
    });
  loading = (async () => {
    if (webgpu) {
      try {
        tts = await tryLoad("webgpu", "fp32");
        self.postMessage({ type: "device", device: "webgpu" });
        return tts;
      } catch (e) {
        console.warn("[kokoro] webgpu failed, using wasm", e);
      }
    }
    tts = await tryLoad("wasm", "q8");
    self.postMessage({ type: "device", device: "wasm" });
    return tts;
  })();
  return loading;
}

self.onmessage = async (ev) => {
  const { id, type, text, voice, speed, modelId } = ev.data;
  try {
    if (type === "load") {
      await load(modelId);
      self.postMessage({ id, type: "loaded" });
      return;
    }
    if (type === "speak") {
      const model = await load(modelId);
      const audio = await model.generate(text, { voice, speed });
      const samples = audio.audio; // Float32Array
      self.postMessage({ id, type: "audio", samples, sampleRate: audio.sampling_rate }, [samples.buffer]);
    }
  } catch (e) {
    self.postMessage({ id, type: "error", message: String(e?.message || e) });
  }
};
