// Story Magic 3D — UI + generation pipeline.
import { CONFIG, VOICES } from "./config.js";
import { writeStory } from "./providers/story.js";
import { characterImage, sceneImage } from "./providers/image.js";
import { sceneVideo } from "./providers/video.js";
import { speak, warmUpVoice, pickBrowserVoice } from "./providers/voice.js";
import { apiHealthy, setOffline } from "./providers/api.js";
import { Player } from "./player.js";
import { canRecord, recordMovie } from "./recorder.js";

const $ = (s) => document.querySelector(s);
const state = { voice: VOICES[0], ctx: null, player: null, movie: null, runId: 0, online: false };
window.__storyMagic = state; // handy for debugging / measuring

// ───────────────────────── input screen ─────────────────────────
const IDEAS = [
  "🐰 A bunny who visits the moon", "🦕 A friendly dinosaur picnic", "🌈 Painting a rainbow bridge",
  "🐳 Swimming with a gentle whale", "🚀 A cozy trip to the stars", "🧁 A magical cupcake bakery",
  "🐢 Helping a tiny turtle home", "🏰 A castle made of clouds", "🦋 A butterfly birthday party",
  "🐧 A penguin who learns to slide", "🌻 A garden that sings softly", "🎈 Floating on balloons",
];

function initForm() {
  $("#f-age").addEventListener("input", (e) => ($("#age-out").textContent = e.target.value));
  const chips = $("#chips");
  [...IDEAS].sort(() => Math.random() - 0.5).slice(0, 6).forEach((t) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = t;
    b.onclick = () => { $("#f-idea").value = t.replace(/^\S+\s/, ""); $("#f-idea").focus(); };
    chips.appendChild(b);
  });

  const vbox = $("#voices");
  VOICES.forEach((v, i) => {
    const d = document.createElement("div");
    d.className = "voice"; d.setAttribute("role", "radio"); d.tabIndex = 0;
    d.setAttribute("aria-checked", i === 0 ? "true" : "false");
    d.textContent = v.label;
    const choose = () => {
      state.voice = v;
      [...vbox.children].forEach((c) => c.setAttribute("aria-checked", c === d ? "true" : "false"));
    };
    d.onclick = choose;
    d.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } };
    vbox.appendChild(d);
  });

  initMic();
  $("#story-form").addEventListener("submit", onSubmit);
  checkMagic();
}

function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("#mic"), hint = $("#mic-hint");
  if (!SR) { mic.onclick = () => toast("🎤 This browser can't listen yet — typing works too!"); return; }
  let rec = null;
  mic.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false;
    const before = $("#f-idea").value.trim();
    rec.onresult = (e) => {
      const t = [...e.results].map((r) => r[0].transcript).join(" ");
      $("#f-idea").value = (before ? before + " " : "") + t;
    };
    rec.onstart = () => { mic.classList.add("listening"); hint.textContent = "👂 I'm listening… tell me your idea!"; };
    rec.onerror = (e) => { hint.textContent = e.error === "not-allowed" ? "🎤 Ask a grown-up to allow the microphone." : "🎤 I didn't catch that — try again?"; };
    rec.onend = () => { mic.classList.remove("listening"); rec = null; if (hint.textContent.startsWith("👂")) hint.textContent = "✨ Got it!"; };
    rec.start();
  };
}

async function checkMagic() {
  state.online = await apiHealthy();
  $("#account-line").textContent = state.online
    ? "🎬 3D movie magic is ready · about 2 minutes per movie"
    : "🌙 The 3D movie studio is resting — you'll get a picture story with a gentle voice.";
  if (!state.online) warmUpVoice(); // the offline voice needs its model
}

// ───────────────────────── generation ─────────────────────────
function ensureCtx() {
  if (!state.ctx) state.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (state.ctx.state === "suspended") state.ctx.resume().catch(() => {});
  return state.ctx;
}

function onSubmit(e) {
  e.preventDefault();
  const input = {
    name: cleanName($("#f-name").value) || "Little Star",
    age: +$("#f-age").value,
    favorite: $("#f-fav").value.trim().slice(0, 40),
    idea: $("#f-idea").value.trim().slice(0, 300),
  };
  ensureCtx(); // created inside the click → audio is allowed later
  setOffline(!state.online);
  generate(input);
}

function cleanName(s) { return s.replace(/[<>{}"`]/g, "").trim().slice(0, 20); }

const STEP_DEFS = [
  ["story", "✍️", "Writing your story"],
  ["hero", "🎨", "Designing your 3D hero"],
  ["scenes", "🖼️", "Setting up the scenes"],
  ["video", "🎬", "Animating the scenes"],
  ["voice", "🎙️", "Recording the storyteller"],
  ["music", "🎵", "Composing a lullaby"],
];
const FUN = [
  "Did you know? Owls can turn their heads almost all the way around! 🦉",
  "Fun fact: a group of baby bunnies is called a fluffle! 🐰",
  "Did you know? Sea otters hold hands when they sleep! 🦦",
  "Fun fact: butterflies taste with their feet! 🦋",
  "Did you know? Clouds can weigh as much as 100 elephants — but they float! ☁️",
  "Fun fact: penguins give pebbles to friends they like! 🐧",
  "Did you know? A snail can sleep for three whole years! 🐌",
];

async function generate(input) {
  const run = ++state.runId;
  const alive = () => run === state.runId;
  show("screen-loading");
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  const timings = { start: new Date().toISOString(), steps: {}, scenes: [] };
  state.timings = timings;
  const N = CONFIG.scenes;

  // ── loading UI ──
  const ul = $("#steps"); ul.innerHTML = "";
  const stepEl = {};
  STEP_DEFS.forEach(([k, emo, label]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="st">${emo}</span><span class="tx"></span>`;
    li.querySelector(".tx").textContent = label + "…";
    ul.appendChild(li); stepEl[k] = li;
  });
  const setStep = (k, cls, text) => {
    const li = stepEl[k]; li.className = cls;
    if (text) li.querySelector(".tx").textContent = text;
    if (cls === "done") li.querySelector(".st").textContent = "✅";
  };
  const chips = $("#scene-chips"); chips.innerHTML = "";
  const chipEl = [];
  for (let i = 0; i < N; i++) {
    const d = document.createElement("div");
    d.innerHTML = `<b>⏳</b>Scene ${i + 1}`;
    chips.appendChild(d); chipEl.push(d);
  }
  const chip = (i, emo, cls) => { chipEl[i].querySelector("b").textContent = emo; chipEl[i].className = cls || ""; };
  let funI = Math.floor(Math.random() * FUN.length);
  $("#fun-fact").textContent = FUN[funI];
  const funTimer = setInterval(() => { $("#fun-fact").textContent = FUN[++funI % FUN.length]; }, 9000);
  $("#load-title").textContent = "Making your movie…";

  const prog = { story: 0, hero: 0, imgs: 0, vids: 0, voice: 0 };
  const voiceTotal = N + 2;
  const tick = () => {
    const w = { story: 8, hero: 8, img: 14, vid: 55, voice: 15 };
    const done = w.story * prog.story + w.hero * prog.hero + w.img * (prog.imgs / N) + w.vid * (prog.vids / N) + w.voice * (prog.voice / voiceTotal);
    // video progress is invisible while rendering, so let time fill that part smoothly
    const timeFill = Math.min(0.97, elapsed() / CONFIG.maxWaitSeconds) * 100;
    const pct = Math.max(done, Math.min(timeFill, done + 30));
    $("#bar-fill").style.width = `${Math.max(3, Math.min(100, pct))}%`;
    const left = Math.max(0, Math.round(CONFIG.maxWaitSeconds - elapsed()));
    $("#eta").textContent = prog.vids === N
      ? "⏱️ Almost ready…"
      : `⏱️ About ${left > 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : `${Math.max(5, left)} seconds`} left — real 3D animation is on its way!`;
  };
  const etaTimer = setInterval(tick, 500);
  tick();
  const cleanup = () => { clearInterval(etaTimer); clearInterval(funTimer); };
  $("#cancel").onclick = () => { state.runId++; cleanup(); show("screen-input"); };

  try {
    // 1. STORY (also the daily-limit gate)
    setStep("story", "doing");
    let ts = performance.now();
    let res;
    try {
      res = await writeStory(input, (msg) => setStep("story", "doing", `Writing your story… ${msg}`));
    } catch (e) {
      cleanup();
      if (!alive()) return;
      show("screen-input");
      if (e.code === "daily_limit") return friendly("🌙 You made lots of stories today! Your storyteller is resting — come back tomorrow for more magic.");
      if (e.code === "budget_limit") return friendly("🌙 The movie studio is resting today. Come back tomorrow for a brand-new movie!");
      if (e.code === "bad_code") return friendly("🔑 Grown-ups: this site needs its family code. See the README.");
      throw e;
    }
    if (!alive()) return;
    const { story, token, left: storiesLeft } = res;
    timings.steps.story = secs(ts); timings.storySource = res.source;
    prog.story = 1;
    setStep("story", "done", `Story ready: “${story.title}”`);
    $("#load-title").textContent = `Making “${story.title}”…`;
    console.info("[story]", story);

    // 2. VOICE — runs alongside everything else
    const texts = [
      `${story.title}. A story made just for ${input.name}.`,
      ...story.scenes.map((s) => s.text),
      `The end. Goodnight, ${input.name}. Sweet dreams.`,
    ];
    if (!token || CONFIG.voiceProvider === "kokoro") warmUpVoice();
    const voiceJob = (async () => {
      const tv = performance.now();
      setStep("voice", "doing");
      const out = await mapLimit(texts, 4, async (t) => {
        const r = await speak(state.ctx, t, state.voice, token);
        prog.voice++;
        setStep("voice", "doing", `Recording the storyteller… ${prog.voice} of ${texts.length}`);
        return r;
      });
      timings.steps.voice = secs(tv); timings.voiceSource = out[1]?.source;
      setStep("voice", "done", "Storyteller ready");
      return out;
    })();

    // 3. HERO (one 3D portrait, used as the face reference for every scene)
    setStep("hero", "doing");
    ts = performance.now();
    const hero = await characterImage(story, token);
    if (!alive()) return;
    timings.steps.hero = secs(ts); timings.heroSource = hero.source;
    prog.hero = 1;
    setStep("hero", "done", "Your 3D hero is ready");

    // 4. SCENES — all 6 stills at once, each starts its video the moment it's ready
    setStep("scenes", "doing");
    setStep("video", "doing", "Animating the scenes…");
    const stills = new Array(N);
    const clipPromises = new Array(N);
    const clips = new Array(N).fill(null);
    let animDone = 0;
    await Promise.all(Array.from({ length: N }, async (_, i) => {
      chip(i, "🎨", "work");
      const tI = performance.now();
      stills[i] = await sceneImage(story, i, hero, token);
      const rec = { scene: i + 1, image: secs(tI), imageSource: stills[i].source };
      timings.scenes[i] = rec;
      prog.imgs++;
      setStep("scenes", prog.imgs === N ? "done" : "doing", prog.imgs === N ? "All scenes set up" : `Setting up the scenes… ${prog.imgs} of ${N}`);
      chip(i, "🎬", "work");
      const tV = performance.now();
      clipPromises[i] = sceneVideo(i, stills[i], token).then((c) => {
        rec.video = secs(tV); rec.videoDoneAt = Math.round(elapsed()); rec.clip = c ? "video" : "still";
        clips[i] = c;
        prog.vids++;
        if (c) animDone++;
        chip(i, c ? "✅" : "🖼️", "done");
        setStep("video", prog.vids === N ? "done" : "doing",
          prog.vids === N ? (animDone ? "All scenes animated" : "Gentle picture scenes") : `Animating… ${prog.vids} of ${N} scenes done`);
        return c;
      });
    }));
    if (!alive()) return;

    // 5. Wait for clips, but never past the 2-minute promise
    const deadline = Math.max(0, CONFIG.maxWaitSeconds - elapsed()) * 1000;
    await Promise.race([Promise.all(clipPromises), sleep(deadline)]);
    const narr = await voiceJob;
    if (!alive()) return;
    setStep("music", "done", "Lullaby composed");

    const items = [
      { kind: "title", narration: narr[0], bg: hero.src },
      ...story.scenes.map((s, i) => ({
        kind: "scene", n: i + 1, text: s.text, still: stills[i],
        clip: clips[i] || { type: "still", src: stills[i].src }, clipDuration: 0, narration: narr[i + 1],
      })),
      { kind: "end", narration: narr[texts.length - 1], bg: stills[N - 1]?.src || hero.src },
    ];
    // clip lengths for timing
    await Promise.all(items.map(async (it) => { if (it.clip?.type === "video") it.clipDuration = await videoDuration(it.clip.src); }));
    // late clips swap in before their scene plays
    clipPromises.forEach((p, i) => p.then(async (c) => {
      const it = items[i + 1];
      if (c && it.clip.type !== "video") {
        it.clipDuration = await videoDuration(c.src);
        it.clip = c;
      }
      state.player?.refreshNote?.();
    }));

    timings.waited = secs(t0);
    timings.readyAtStart = clips.filter(Boolean).length;
    console.info("[timings]", JSON.stringify(timings));
    cleanup();
    $("#bar-fill").style.width = "100%";
    openPlayer({ title: story.title, name: input.name, items, story, hero, storiesLeft, pending: () => N - prog.vids });
  } catch (err) {
    console.error(err);
    cleanup();
    if (!alive()) return;
    show("screen-input");
    friendly("🌧️ Oops, the story magic got sleepy. Let's try again!");
  }
}

async function mapLimit(arr, k, fn) {
  const out = new Array(arr.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(k, arr.length) }, async () => {
    while (next < arr.length) { const i = next++; out[i] = await fn(arr[i], i); }
  }));
  return out;
}
const secs = (t) => Math.round((performance.now() - t) / 100) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function videoDuration(src) {
  return new Promise((res) => {
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true;
    const to = setTimeout(() => res(6), 15000);
    v.onloadedmetadata = () => { clearTimeout(to); res(isFinite(v.duration) ? v.duration : 6); };
    v.onerror = () => { clearTimeout(to); res(6); };
    v.src = src;
  });
}

// ───────────────────────── player ─────────────────────────
function openPlayer(movie) {
  state.movie = movie;
  show("screen-player");
  state.player?.stop();
  const els = {
    stage: $("#stage"),
    layers: [...document.querySelectorAll("#stage .layer")],
    captions: $("#captions"),
    dots: $("#dots"),
    playBtn: $("#c-play"),
    musicBtn: $("#c-music"),
  };
  els.layers.forEach((l) => { l.className = "layer"; l.innerHTML = ""; });
  document.documentElement.style.setProperty("--fade", `${CONFIG.crossfadeMs}ms`);
  const p = new Player(els, state.ctx);
  state.player = p;
  p.load(movie);
  p.preview(); // title card under the play button

  const big = $("#big-play");
  big.classList.remove("hide");
  big.querySelector("span").textContent = "Play my movie";
  big.onclick = () => { big.classList.add("hide"); p.play(0); };
  $("#c-play").onclick = () => { big.classList.add("hide"); p.togglePause(); };
  $("#c-replay").onclick = () => { big.classList.add("hide"); p.replay(); };
  $("#c-music").onclick = () => p.toggleMusic();
  $("#c-new").onclick = () => { p.stop(); state.runId++; show("screen-input"); };
  p.on("ended", () => { if (!state.recording) { big.classList.remove("hide"); big.querySelector("span").textContent = "Watch again"; } });

  const note = () => {
    const scenes = movie.items.filter((i) => i.kind === "scene");
    const vids = scenes.filter((i) => i.clip.type === "video").length;
    const parts = [];
    if (vids === scenes.length) parts.push(`🎬 Brand-new 3D animation, made just now for ${movie.name}.`);
    else if (movie.pending?.() > 0) parts.push(`🎬 ${vids} of ${scenes.length} scenes animated — the rest are finishing and pop in before they play.`);
    else if (vids > 0) parts.push(`🎬 ${vids} of ${scenes.length} scenes animated, the rest are gentle 3D pictures.`);
    else parts.push("🖼️ Today's movie uses gentle picture scenes.");
    if (movie.storiesLeft != null) parts.push(movie.storiesLeft > 0 ? `✨ ${movie.storiesLeft} more ${movie.storiesLeft === 1 ? "story" : "stories"} today.` : "🌙 That was today's last story.");
    $("#player-note").textContent = parts.join(" ");
  };
  p.refreshNote = note;
  note();

  const dl = $("#c-download");
  dl.onclick = async () => {
    const can = canRecord(movie);
    if (!can.ok) return toast(can.why);
    if (can.speechOnly) toast("💡 The browser voice can't be saved — the movie will have music only.");
    big.classList.add("hide");
    state.recording = true;
    dl.disabled = true;
    document.querySelector(".controls").classList.add("locked");
    const label = dl.querySelector("span");
    label.textContent = "Saving… 0%";
    try {
      const { blob, ext } = await recordMovie(p, (f) => (label.textContent = `Saving… ${Math.round(f * 100)}%`));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${movie.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "my-story"}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      toast("🎉 Your movie is saved!");
    } catch (e) {
      console.error(e);
      toast("😴 Saving didn't work this time — you can still watch it here.");
    } finally {
      state.recording = false;
      dl.disabled = false;
      document.querySelector(".controls").classList.remove("locked");
      label.textContent = "Download my movie";
    }
  };
}

// ───────────────────────── helpers ─────────────────────────
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 5000);
}
function friendly(msg) {
  const box = $("#friendly");
  box.textContent = msg;
  box.hidden = false;
  toast(msg);
}

window.addEventListener("unhandledrejection", (e) => { console.warn("[unhandled]", e.reason); });

initForm();
