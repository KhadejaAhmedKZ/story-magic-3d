// Story Magic 3D — Cloudflare Worker proxy for the MiniMax API.
//
// • Holds the MiniMax API key (secret MINIMAX_API_KEY) — it never reaches the browser.
// • Builds every prompt server-side (style + epilepsy-safety text is always added).
// • Enforces spending caps: stories per device per day, stories per day in total,
//   stories per month in total, plus per-story limits on images / clips / voice lines.
//
// Routes (JSON unless noted):
//   GET  /api/health
//   POST /api/story   {deviceId, name, age, favorite, idea, code?}       → {story, token, left}
//   POST /api/image   {token, kind:"hero"|"scene", scene?, refImage?}    → {image: dataURL}
//   POST /api/video   {token, scene, firstFrame}                          → {taskId}
//   GET  /api/video?token=&task=                                          → {status, fileUrl?}
//   GET  /api/file?token=&task=     → streams the finished mp4 (with CORS)
//   POST /api/tts     {token, text, voice}                                → {audio: base64 mp3, words?}

const API = "https://api.minimax.io";

const STYLE =
  "Soft 3D animated children's film, Pixar style render, adorable rounded characters, big expressive eyes, " +
  "warm golden lighting, pastel colors, smooth gentle motion, calm lighting, no flashing, no strobe, no text.";
const SAFETY =
  "Calm steady lighting, no flashing, no strobe, no flickering, no fast cuts, no sudden brightness changes, slow gentle motion. Full-frame 16:9 picture, no letterbox, no black bars.";

const VOICES = {
  storyteller: "English_CaptivatingStoryteller",
  mama: "English_CalmWoman",
  soft: "English_Soft-spokenGirl",
  papa: "English_Gentle-voiced_man",
  grandpa: "English_WiseScholar",
};
const CAMERA = ["[Push in]", "[Truck right]", "[Pan left]", "[Pull out]", "[Tilt up]", "[Push in]"];

// per-story ceilings (a story normally uses 7 images, 6 clips, 8 voice lines)
const PER_STORY = { image: 12, video: 9, tts: 14 };

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && !cors["Access-Control-Allow-Origin"]) return json({ error: "origin_not_allowed" }, 403, cors);

    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, mock: env.MOCK === "1", hasKey: !!env.MINIMAX_API_KEY, videoModel: env.VIDEO_MODEL }, 200, cors);
      }
      if (url.pathname === "/api/story" && req.method === "POST") return await story(req, env, cors);
      if (url.pathname === "/api/image" && req.method === "POST") return await image(req, env, cors);
      if (url.pathname === "/api/video" && req.method === "POST") return await videoStart(req, env, cors);
      if (url.pathname === "/api/video" && req.method === "GET") return await videoPoll(url, env, cors);
      if (url.pathname === "/api/file" && req.method === "GET") return await videoFile(url, env, cors);
      if (url.pathname === "/api/tts" && req.method === "POST") return await tts(req, env, cors);
      return json({ error: "not_found" }, 404, cors);
    } catch (e) {
      const status = e.status || 500;
      return json({ error: e.code || "server_error", message: String(e.message || e) }, status, cors);
    }
  },
};

// ───────────────────────── story (quota gate) ─────────────────────────
async function story(req, env, cors) {
  const b = await req.json();
  if (env.ACCESS_CODE && b.code !== env.ACCESS_CODE) throw err(401, "bad_code", "family code needed");
  const deviceId = String(b.deviceId || "").slice(0, 64);
  if (!/^[\w-]{8,64}$/.test(deviceId)) throw err(400, "bad_device");

  const day = dayKey(env);
  const month = day.slice(0, 7);
  const perDevice = int(env.DAILY_LIMIT_PER_DEVICE, 6);
  const perDay = int(env.DAILY_LIMIT_TOTAL, 30);
  const perMonth = int(env.MONTHLY_LIMIT_TOTAL, 200);
  const [dCount, tCount, mCount] = await Promise.all([
    kvInt(env, `d:${day}:${deviceId}`), kvInt(env, `t:${day}`), kvInt(env, `m:${month}`),
  ]);
  if (dCount >= perDevice) throw err(429, "daily_limit", `You made ${perDevice} stories today`);
  if (tCount >= perDay || mCount >= perMonth) throw err(429, "budget_limit", "story budget reached");

  const input = {
    name: clean(b.name, 20) || "Little Star",
    age: Math.min(12, Math.max(3, int(b.age, 6))),
    favorite: clean(b.favorite, 40),
    idea: clean(b.idea, 300),
  };
  let s;
  try {
    s = await writeStory(env, input);
  } catch (e) {
    // story model down → use the browser's template story so pictures/clips can still be made
    try { s = validateStory(b.fallback, input); s.fallback = true; } catch { throw e; }
  }

  // count it only once a story was really produced
  const ttl = { expirationTtl: 60 * 60 * 24 * 40 };
  await Promise.all([
    env.QUOTA.put(`d:${day}:${deviceId}`, String(dCount + 1), ttl),
    env.QUOTA.put(`t:${day}`, String(tCount + 1), ttl),
    env.QUOTA.put(`m:${month}`, String(mCount + 1), { expirationTtl: 60 * 60 * 24 * 70 }),
  ]);
  const token = await makeToken(env, { sid: crypto.randomUUID(), exp: Date.now() + 3 * 3600e3 });
  // remember the story server-side so image/video prompts can only come from it
  await env.QUOTA.put(`s:${(await readToken(env, token)).sid}`, JSON.stringify(s), { expirationTtl: 3 * 3600 });
  return json({ story: s, token, left: perDevice - dCount - 1 }, 200, cors);
}

function storyPrompt({ name, age, favorite, idea }) {
  return `You write gentle, kind bedtime stories for young children.
Write a NEW story for ${name}, age ${age}. ${name} is the hero.
Story idea from the child: "${idea || "a surprise adventure"}".
Their favorite thing: "${favorite || "stars"}" — include it in the story.

Rules:
- Exactly 6 scenes. Each scene "text" = exactly 2 short sentences, 22 to 28 words total, simple words for a ${age}-year-old.
- Kind and calm. No danger, no villains, nothing scary. A small problem solved with kindness or courage.
- Never guess whether ${name} is a boy or a girl: do NOT use he/she/him/her/his/hers for ${name}. Use the name "${name}" (or "they") instead. The sidekick may have pronouns.
- Scene 6 ends with a small, warm lesson.
- "character": ONE fixed visual description of ${name} for an animator: approximate age, hair, skin tone, outfit with colors, plus one cute sidekick (species + colors). 25-40 words. It never changes between scenes.
- "setting": the main place of the story with colors and light, 10-20 words.
- "video_prompt" for each scene: describe ONE simple, gentle action of the hero and sidekick and where they are, 15-30 words. Do NOT describe the hero's looks. No text, no signs, no flashing lights, no lightning, no fireworks, no fast motion.
- "mood": one or two words (e.g. "cozy", "dreamy", "playful").

Reply with ONLY this JSON:
{"title":"...","character":"...","setting":"...","mood":"...","scenes":[{"text":"...","video_prompt":"..."}]}`;
}

async function writeStory(env, input) {
  if (env.MOCK === "1") return mockStory(input);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await mm(env, "/v1/chat/completions", {
        model: env.TEXT_MODEL || "MiniMax-M3.1-Flash",
        messages: [{ role: "user", content: storyPrompt(input) }],
        max_completion_tokens: 2500,
        reasoning_effort: "low",
        temperature: 1,
      });
      const text = r?.choices?.[0]?.message?.content || "";
      return validateStory(parseJson(text), input);
    } catch (e) {
      lastErr = e;
    }
  }
  throw err(502, "story_failed", String(lastErr?.message || lastErr));
}

function parseJson(text) {
  let t = String(text).replace(/<think>[\s\S]*?<\/think>/g, "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const a = t.indexOf("{"), z = t.lastIndexOf("}");
  if (a < 0 || z <= a) throw new Error("no json");
  t = t.slice(a, z + 1);
  try { return JSON.parse(t); } catch { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"')); }
}

function validateStory(s, input) {
  if (!Array.isArray(s?.scenes) || s.scenes.length < 6) throw new Error("need 6 scenes");
  const scenes = s.scenes.slice(0, 6).map((x, i) => {
    const text = clean(x.text, 400), vp = clean(x.video_prompt || x.videoPrompt, 400);
    if (text.split(/\s+/).length < 10 || !vp) throw new Error(`bad scene ${i + 1}`);
    return { text, video_prompt: vp };
  });
  const character = clean(s.character, 400);
  if (character.length < 15) throw new Error("no character");
  return {
    title: clean(s.title, 70) || `${input.name}'s Magical Day`,
    character,
    setting: clean(s.setting, 200),
    mood: clean(s.mood, 30) || "cozy",
    scenes,
  };
}

// ───────────────────────── images ─────────────────────────
async function image(req, env, cors) {
  const b = await req.json();
  const { sid, story: s } = await authStory(env, b.token);
  await spend(env, sid, "image");
  let prompt;
  if (b.kind === "hero") {
    prompt = `${STYLE} Character portrait, front view, waist-up, smiling warmly at the camera, soft plain pastel background, cinematic soft light. ${s.character}`;
  } else {
    const i = Math.min(5, Math.max(0, int(b.scene, 0)));
    prompt = `${STYLE} Wide cinematic film still, 16:9. ${s.character} ${s.setting ? "Setting: " + s.setting + "." : ""} Scene: ${s.scenes[i].video_prompt} The hero is clearly visible, mid-shot, centered, facing the camera at a gentle angle.`;
  }
  if (env.MOCK === "1") return json({ image: await mockImage(env, b.kind === "hero" ? "hero" : `scene${int(b.scene, 0) + 1}`) }, 200, cors);

  const body = {
    model: "image-01",
    prompt: prompt.slice(0, 1500),
    aspect_ratio: b.kind === "hero" ? "1:1" : "16:9",
    response_format: "base64",
    n: 1,
    prompt_optimizer: false,
  };
  if (b.refImage && /^data:image\/(jpeg|png);base64,/.test(b.refImage) && b.refImage.length < 9e6) {
    body.subject_reference = [{ type: "character", image_file: b.refImage }];
  }
  const r = await mm(env, "/v1/image_generation", body);
  const b64 = r?.data?.image_base64?.[0];
  if (!b64) throw err(502, "image_failed", r?.base_resp?.status_msg || "no image");
  return json({ image: `data:image/jpeg;base64,${b64}` }, 200, cors);
}

// ───────────────────────── video ─────────────────────────
async function videoStart(req, env, cors) {
  const b = await req.json();
  const { sid, story: s } = await authStory(env, b.token);
  await spend(env, sid, "video");
  const i = Math.min(5, Math.max(0, int(b.scene, 0)));
  if (env.MOCK === "1") return json({ taskId: `mock-${i + 1}-${Date.now()}` }, 200, cors);
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(b.firstFrame || "")) throw err(400, "first_frame_required");

  const prompt = `${CAMERA[i]} ${STYLE} ${s.scenes[i].video_prompt} The same character throughout: ${s.character} ${SAFETY}`;
  const r = await mm(env, "/v1/video_generation", {
    model: env.VIDEO_MODEL || "MiniMax-Hailuo-2.3-Fast",
    prompt: prompt.slice(0, 1990),
    first_frame_image: b.firstFrame,
    duration: 6,
    resolution: env.VIDEO_RESOLUTION || "768P",
    prompt_optimizer: true,
    fast_pretreatment: true,
  });
  if (!r?.task_id) throw err(502, "video_failed", r?.base_resp?.status_msg || "no task");
  await env.QUOTA.put(`task:${r.task_id}`, sid, { expirationTtl: 3 * 3600 });
  return json({ taskId: r.task_id }, 200, cors);
}

async function videoPoll(url, env, cors) {
  const task = url.searchParams.get("task") || "";
  await authTask(env, url.searchParams.get("token"), task);
  if (env.MOCK === "1") {
    const [, n, t0] = task.split("-");
    const delay = int(env.MOCK_VIDEO_SECONDS, 40) * 1000 + int(n, 1) * 3000;
    return json({ status: Date.now() - +t0 > delay ? "Success" : "Processing" }, 200, cors);
  }
  const r = await mm(env, `/v1/query/video_generation?task_id=${encodeURIComponent(task)}`, null, "GET");
  const status = r?.status || "Unknown";
  const code = r?.base_resp?.status_code;
  return json({ status, code, moderated: code === 1026 || code === 1027 }, 200, cors);
}

async function videoFile(url, env, cors) {
  const task = url.searchParams.get("task") || "";
  await authTask(env, url.searchParams.get("token"), task);
  let fileUrl;
  if (env.MOCK === "1") {
    fileUrl = `${env.MOCK_ASSET_BASE}/clip${task.split("-")[1]}.mp4`;
  } else {
    const q = await mm(env, `/v1/query/video_generation?task_id=${encodeURIComponent(task)}`, null, "GET");
    if (q?.status !== "Success" || !q.file_id) throw err(409, "not_ready");
    const f = await mm(env, `/v1/files/retrieve?file_id=${encodeURIComponent(q.file_id)}`, null, "GET");
    fileUrl = f?.file?.download_url;
    if (!fileUrl) throw err(502, "no_file");
  }
  const up = await fetch(fileUrl);
  if (!up.ok) throw err(502, "download_failed");
  return new Response(up.body, {
    headers: { ...cors, "Content-Type": "video/mp4", "Cache-Control": "private, max-age=3600" },
  });
}

// ───────────────────────── voice ─────────────────────────
async function tts(req, env, cors) {
  const b = await req.json();
  const { sid } = await authStory(env, b.token);
  await spend(env, sid, "tts");
  const text = clean(b.text, 600);
  if (!text) throw err(400, "no_text");
  if (env.MOCK === "1") throw err(503, "mock_no_tts"); // browser falls back to Kokoro in mock mode
  const voice = VOICES[b.voice] || VOICES.storyteller;
  const r = await mm(env, "/v1/t2a_v2", {
    model: env.TTS_MODEL || "speech-2.8-hd",
    text,
    stream: false,
    voice_setting: { voice_id: voice, speed: 0.92, vol: 1, pitch: 0, emotion: "calm" },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
    subtitle_enable: true,
    subtitle_type: "word",
  });
  const hex = r?.data?.audio;
  if (!hex) throw err(502, "tts_failed", r?.base_resp?.status_msg || "no audio");
  let words = null;
  try {
    if (r.data.subtitle_file) {
      const sub = await (await fetch(r.data.subtitle_file)).json();
      words = extractWords(sub);
    }
  } catch {}
  return json({ audio: hexToBase64(hex), words, ms: r?.extra_info?.audio_length }, 200, cors);
}

function extractWords(sub) {
  // accept a few shapes: [{text,time_begin,time_end,timestamped_words:[...]}] etc.
  const out = [];
  const arr = Array.isArray(sub) ? sub : sub?.subtitles || sub?.data || [];
  for (const seg of arr) {
    const ws = seg.timestamped_words || seg.words || [];
    for (const w of ws) {
      const t = w.word || w.text;
      const b = w.time_begin ?? w.begin ?? w.start;
      if (t && b != null) out.push({ w: t, t: Number(b) / 1000 });
    }
  }
  return out.length ? out : null;
}

// ───────────────────────── helpers ─────────────────────────
async function mm(env, path, body, method = "POST") {
  if (!env.MINIMAX_API_KEY) throw err(500, "no_key", "MINIMAX_API_KEY secret is not set");
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${env.MINIMAX_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  const code = data?.base_resp?.status_code;
  if (!r.ok || (code && code !== 0 && !(path.startsWith("/v1/query") && (code === 1026 || code === 1027)))) {
    const status = code === 1002 ? 429 : code === 1008 ? 402 : 502;
    throw err(status, code === 1008 ? "balance_low" : `minimax_${code || r.status}`, data?.base_resp?.status_msg || r.statusText);
  }
  return data;
}

async function authStory(env, token) {
  const t = await readToken(env, token);
  const s = await env.QUOTA.get(`s:${t.sid}`, "json");
  if (!s) throw err(401, "story_expired");
  return { sid: t.sid, story: s };
}
async function authTask(env, token, task) {
  const t = await readToken(env, token);
  const owner = await env.QUOTA.get(`task:${task}`);
  if (env.MOCK !== "1" && owner !== t.sid) throw err(403, "not_your_task");
}

async function spend(env, sid, kind) {
  const k = `u:${sid}:${kind}`;
  const n = await kvInt(env, k);
  if (n >= PER_STORY[kind]) throw err(429, "story_limit", `${kind} limit for this story`);
  await env.QUOTA.put(k, String(n + 1), { expirationTtl: 3 * 3600 });
}

async function makeToken(env, payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${await hmac(env, body)}`;
}
async function readToken(env, token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || sig !== (await hmac(env, body))) throw err(401, "bad_token");
  const p = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
  if (p.exp < Date.now()) throw err(401, "token_expired");
  return p;
}
async function hmac(env, data) {
  const secret = env.TOKEN_SECRET || env.MINIMAX_API_KEY || "dev-secret";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function hexToBase64(hex) {
  let bin = "";
  for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return btoa(bin);
}

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes("*") || allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const h = { "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
  if (ok && origin) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function dayKey(env) {
  // the "day" resets at local midnight (default UTC+4, UAE)
  const off = Number(env.TZ_OFFSET_HOURS ?? 4);
  return new Date(Date.now() + off * 3600e3).toISOString().slice(0, 10);
}
async function kvInt(env, k) { return int(await env.QUOTA.get(k), 0); }
function int(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function clean(v, max) { return String(v ?? "").replace(/[<>{}`]/g, "").replace(/\s+/g, " ").trim().slice(0, max); }
function err(status, code, message) { return Object.assign(new Error(message || code), { status, code }); }
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

// ───────────────────────── mock mode (local testing without a key) ─────────────────────────
function mockStory({ name, favorite }) {
  const fav = favorite || "stars";
  return {
    title: `${name} and the Sleepy Little Wave`,
    character: `A six-year-old child named ${name} with curly dark brown hair, warm brown skin, a mustard-yellow knit cardigan with a white collar, and a tiny mint-green sea turtle sidekick named Pip.`,
    setting: "A calm pastel beach at golden hour with soft pink sky and gentle turquoise water.",
    mood: "cozy",
    scenes: [
      { text: `${name} skipped down to the quiet beach with Pip the little turtle. The sky was pink and the waves whispered hello.`, video_prompt: "The child walks slowly along the soft sand with the little turtle beside her, smiling at the calm sea." },
      { text: `Pip stopped and hid inside his shell. "The big wave looks so tall," he whispered, feeling very small today.`, video_prompt: "The little turtle tucks into its shell while the child kneels down beside it with a caring face." },
      { text: `${name} sat beside Pip and smiled. "Let's breathe slowly together, like the waves," she said, and they breathed in and out.`, video_prompt: "The child sits on the sand and breathes slowly with eyes closed while the turtle peeks out of its shell." },
      { text: `Then ${name} showed Pip her favorite ${fav}, shining softly in the sand. Pip peeked out and felt a little braver.`, video_prompt: `The child gently shows something related to ${fav} to the turtle, who slowly peeks out and looks amazed.` },
      { text: `Together they stepped into the shallow water, and the big wave turned into tiny, giggly ripples around their toes.`, video_prompt: "The child and the turtle step into shallow water as tiny gentle ripples wash around them, both smiling." },
      { text: `As the sun went down, Pip hugged ${name}. Being brave is easier when a friend holds your hand.`, video_prompt: "The child hugs the little turtle on the beach under a calm sunset sky, warm golden light." },
    ],
  };
}
async function mockImage(env, name) {
  const r = await fetch(`${env.MOCK_ASSET_BASE}/${name}.jpg`);
  if (!r.ok) throw err(502, "mock_image_missing");
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(bin)}`;
}
