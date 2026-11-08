// Story providers: "proxy" (MiniMax text model via the Worker) and "template" (offline random generator).
// Both return: { title, character, mood, scenes: [{ text, video_prompt }] x6, source }

import { CONFIG } from "../config.js";
import { api, deviceId, ApiError } from "./api.js";

/**
 * Returns { story, token, left, source }.
 * token = permission from the proxy to make this story's pictures, clips and voice.
 * Throws ApiError with code "daily_limit" / "budget_limit" when the day's stories are used up.
 */
export async function writeStory(input, onLog = () => {}) {
  const fallback = templateStory(input);
  if (CONFIG.storyProvider === "proxy") {
    try {
      onLog("Asking the story fairy…");
      const r = await api("/api/story", {
        body: { ...input, deviceId: deviceId(), fallback, code: familyCode() },
        timeoutMs: 45000,
      });
      return { story: r.story, token: r.token, left: r.left, source: r.story.fallback ? "template" : "proxy" };
    } catch (e) {
      if (e instanceof ApiError && ["daily_limit", "budget_limit", "bad_code"].includes(e.code)) throw e;
      console.warn("[story] proxy failed, using template:", e.code, e.message);
    }
  }
  onLog("Using the magic storybook…");
  return { story: fallback, token: null, left: null, source: "template" };
}

function familyCode() {
  try { return localStorage.getItem("sm3d.code") || undefined; } catch { return undefined; }
}

export function parseStoryJson(text) {
  let t = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object");
  t = t.slice(start, end + 1);
  try {
    return JSON.parse(t);
  } catch {
    // common LLM slips: trailing commas, smart quotes
    const fixed = t.replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"');
    return JSON.parse(fixed);
  }
}

export function validateStory(s, input) {
  if (!s || typeof s !== "object") throw new Error("not an object");
  if (!Array.isArray(s.scenes) || s.scenes.length < CONFIG.scenes) throw new Error("need 6 scenes");
  const scenes = s.scenes.slice(0, CONFIG.scenes).map((sc, i) => {
    const text = String(sc.text || "").trim();
    const vp = String(sc.video_prompt || sc.videoPrompt || "").trim();
    if (text.split(/\s+/).length < 5) throw new Error(`scene ${i + 1} text too short`);
    if (!vp) throw new Error(`scene ${i + 1} missing video_prompt`);
    return { text, video_prompt: vp };
  });
  const character = String(s.character || "").trim();
  if (character.length < 15) throw new Error("character missing");
  return {
    title: String(s.title || `${input.name}'s Magical Day`).trim().slice(0, 70),
    character,
    mood: String(s.mood || "cozy").trim(),
    scenes,
  };
}

// ─────────────────────── Template fallback ───────────────────────
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const HAIR = ["curly dark brown hair", "short black hair", "wavy chestnut hair in two puffs", "straight black hair in a ponytail", "fluffy light brown hair", "soft braided black hair"];
const SKIN = ["warm brown skin", "light olive skin", "golden tan skin", "deep brown skin", "rosy fair skin"];
const OUTFIT = ["a mustard-yellow knit cardigan and blue jeans", "a soft lavender hoodie and mint sneakers", "a peach t-shirt with a star and green shorts", "a sky-blue raincoat and yellow boots", "a pink dress with white dots and red shoes"];
const SIDEKICK = [
  ["a tiny round white bunny with pink ears", "Bunbun"],
  ["a fluffy orange kitten with a blue bow", "Mango"],
  ["a small mint-green dragon with soft wings", "Pistachio"],
  ["a chubby baby penguin with a red scarf", "Pebble"],
  ["a little golden puppy with floppy ears", "Biscuit"],
  ["a sleepy lavender owl with round glasses", "Hoot"],
];
const PLACES = [
  ["a sunny meadow full of giant soft flowers", "the meadow"],
  ["a cozy cloud kingdom floating in a pink sky", "the cloud kingdom"],
  ["a gentle underwater garden of glowing shells", "the shell garden"],
  ["a quiet candy-colored forest", "the candy forest"],
  ["a little moon village with round houses", "the moon village"],
  ["a seaside town with pastel boats", "the seaside town"],
];
const FRIENDS = ["a shy baby turtle", "a lost little star", "a tiny worried snail", "a young bird who could not fly yet", "a small cloud who felt grey"];
const LESSONS = [
  "being kind makes every day brighter",
  "it is okay to ask for help",
  "brave hearts can still be gentle",
  "sharing turns one smile into many",
  "taking a deep breath helps us feel calm",
];
const CAMERA = ["slow gentle push-in", "slow pan to the right", "soft slow orbit around the scene", "slow tilt up to the sky", "gentle slow pull-back"];

export function templateStory({ name, age, favorite, idea }) {
  const fav = (favorite || "stars").trim();
  const [sideDesc, sideName] = pick(SIDEKICK);
  const [place, placeShort] = pick(PLACES);
  const friend = pick(FRIENDS);
  const lesson = pick(LESSONS);
  const rawIdea = idea && idea.trim() ? idea.trim().replace(/[.!?]+$/, "") : "";
  const isWorry = /^(i|i'm|im|my|me)\b/i.test(rawIdea);
  const ideaBit = isWorry ? "a brave little adventure, one small step at a time"
    : rawIdea ? `an adventure about ${rawIdea.charAt(0).toLowerCase() + rawIdea.slice(1)}` : `a surprise adventure with ${fav}`;
  const cams = [...CAMERA].sort(() => Math.random() - 0.5);
  const cam = (i) => cams[i % cams.length];

  const character = `A ${age}-year-old child named ${name} with ${pick(HAIR)}, ${pick(SKIN)}, wearing ${pick(OUTFIT)}, with sidekick ${sideName}, ${sideDesc}.`;

  const scenes = [
    {
      text: `One quiet morning, ${name} woke up smiling, because today felt special. ${sideName} the sidekick hopped close and whispered, "Let's go on ${ideaBit}!"`,
      video_prompt: `The child stretches and smiles in a cozy pastel bedroom while the sidekick hops onto the bed, morning sunlight, ${cam(0)}.`,
    },
    {
      text: `Together they walked into ${place}, where everything glowed softly. ${name} spotted something wonderful: a sparkle of ${fav} floating in the warm air.`,
      video_prompt: `The child and sidekick walk slowly into ${place}, looking around in wonder, ${cam(1)}.`,
    },
    {
      text: `Then they heard a tiny sniffle and found ${friend}. "Don't worry," said ${name} kindly, "we will help you, one little step at a time."`,
      video_prompt: `The child kneels down gently to comfort ${friend} in ${placeShort}, soft warm light, ${cam(2)}.`,
    },
    {
      text: `${name} took a slow, deep breath and had a clever idea using ${fav}. ${sideName} cheered quietly as the plan began to work, little by little.`,
      video_prompt: `The child holds up something related to ${fav} with a happy idea face while the sidekick bounces, ${cam(3)}.`,
    },
    {
      text: `Soon ${friend} was smiling again, and the whole of ${placeShort} seemed to glow with happiness. Everyone shared a big, gentle hug together.`,
      video_prompt: `The child, the sidekick and the new friend share a gentle hug as soft petals drift down, ${cam(4)}.`,
    },
    {
      text: `As the sky turned soft pink, ${name} walked home feeling warm inside. Today ${name} learned that ${lesson}. Goodnight, little hero.`,
      video_prompt: `The child and sidekick walk home along a path under a calm pink sunset sky, ${cam(5)}.`,
    },
  ];

  const titles = [
    `${name} and the Magic of ${cap(fav)}`,
    `${name}'s Gentle Adventure`,
    `${name}, ${sideName} and the Little Wish`,
    `The Day ${name} Helped a Friend`,
  ];
  return { title: pick(titles), character, setting: place, mood: pick(["cozy", "dreamy", "playful"]), scenes };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
