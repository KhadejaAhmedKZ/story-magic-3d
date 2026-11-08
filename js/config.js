// ─────────────────────────────────────────────────────────────
//  Story Magic 3D — settings
//  Switch any provider by changing ONE string below.
//  URL overrides for testing:  ?api=http://localhost:8787&voice=kokoro
// ─────────────────────────────────────────────────────────────

export const CONFIG = {
  // Your Cloudflare Worker URL (holds the MiniMax key). See README → "Deploy the proxy".
  apiBase: "https://story-magic-proxy.khadeja123412.workers.dev",

  storyProvider: "proxy",   // "proxy" (MiniMax text model) | "template" (offline generator)
  imageProvider: "proxy",   // "proxy" (MiniMax image-01)   | "painted" (offline emergency art)
  videoProvider: "proxy",   // "proxy" (MiniMax Hailuo)      | "none" (3D stills with gentle motion)
  voiceProvider: "proxy",   // "proxy" (MiniMax speech-2.8)  | "kokoro" (free, in-browser) | "browser"

  // The whole wait must stay under 2 minutes. When this many seconds have passed since
  // "Make My Story", the movie starts; any clip still rendering keeps going in the background
  // and swaps in before its scene plays (or that scene uses its 3D still with gentle motion).
  maxWaitSeconds: 105,

  kokoro: { modelId: "onnx-community/Kokoro-82M-v1.0-ONNX", speed: 0.95 },

  scenes: 6,
  crossfadeMs: 1600,        // epilepsy-safe: always ≥ 1000 ms
  titleSeconds: 4,
  endSeconds: 5,
  sceneMinSeconds: 3.5,     // a scene never shows for less than this
  afterVoiceSeconds: 0.5,   // tiny breath after the voice before the next scene fades in
  voiceLeadSeconds: 0.3,    // the voice starts this soon after a scene appears
};

// Voice picker: proxy voice key (MiniMax) + Kokoro / browser fallbacks.
export const VOICES = [
  { id: "storyteller", label: "Storyteller",   kokoro: "af_heart",   lang: "en-US", female: true },
  { id: "mama",        label: "Calm Mama",     kokoro: "af_bella",   lang: "en-US", female: true },
  { id: "soft",        label: "Soft Sister",   kokoro: "bf_emma",    lang: "en-GB", female: true },
  { id: "papa",        label: "Gentle Papa",   kokoro: "am_michael", lang: "en-US", female: false },
  { id: "grandpa",     label: "Wise Grandpa",  kokoro: "bm_george",  lang: "en-GB", female: false },
];

// URL overrides (handy for local testing; never needed in production)
const q = new URLSearchParams(location.search);
if (q.get("api")) CONFIG.apiBase = q.get("api");
if (q.get("story")) CONFIG.storyProvider = q.get("story");
if (q.get("image")) CONFIG.imageProvider = q.get("image");
if (q.get("video")) CONFIG.videoProvider = q.get("video");
if (q.get("voice")) CONFIG.voiceProvider = q.get("voice");
if (q.get("wait")) CONFIG.maxWaitSeconds = +q.get("wait");
