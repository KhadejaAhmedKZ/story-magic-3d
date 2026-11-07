// Image providers: "proxy" (MiniMax image-01, 3D stills) and "painted" (offline canvas art, emergency only).
// Stills are used as (a) the first frame for image-to-video, so the hero looks the same in
// every scene, and (b) the per-scene fallback when a video clip fails.

import { CONFIG } from "../config.js";
import { api } from "./api.js";

// Stills come back as data: URLs, so they never expire and can be recorded into the download.
export async function characterImage(story, token) {
  if (CONFIG.imageProvider === "proxy" && token) {
    for (let a = 0; a < 2; a++) {
      try {
        const r = await api("/api/image", { body: { token, kind: "hero" }, timeoutMs: 45000 });
        return { src: r.image, source: "proxy" };
      } catch (e) {
        console.warn("[image] hero failed:", e.code, e.message);
        if (e.code === "story_limit" || e.code === "balance_low") break;
      }
    }
  }
  return { src: paintScene(story, -1), source: "painted" };
}

export async function sceneImage(story, i, hero, token) {
  if (CONFIG.imageProvider === "proxy" && token) {
    for (let a = 0; a < 2; a++) {
      try {
        const body = { token, kind: "scene", scene: i };
        if (hero?.source === "proxy" && a === 0) body.refImage = hero.src; // keeps the hero's face consistent
        const r = await api("/api/image", { body, timeoutMs: 45000 });
        return { src: r.image, source: "proxy" };
      } catch (e) {
        console.warn(`[image] scene ${i + 1} attempt ${a + 1} failed:`, e.code, e.message);
        if (e.code === "story_limit" || e.code === "balance_low") break;
      }
    }
  }
  return { src: paintScene(story, i), source: "painted" };
}

// ─────────────── Emergency offline art (soft pastel canvas scene) ───────────────
const SKIES = [
  ["#ffd6e8", "#ffeccf"], ["#cfe9ff", "#fff1d6"], ["#e5d9ff", "#ffe0ec"],
  ["#c9f2e3", "#fff6c9"], ["#ffe3c9", "#e3d4ff"], ["#d4ecff", "#ffd9e6"],
];

export function paintScene(story, i) {
  const W = 1280, H = 720;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const seed = hash((story.title || "") + i);
  const rnd = mulberry(seed);
  const [top, bottom] = SKIES[Math.abs(seed) % SKIES.length];

  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, top); sky.addColorStop(1, bottom);
  g.fillStyle = sky; g.fillRect(0, 0, W, H);

  // soft sun glow
  const sx = 200 + rnd() * 880, sy = 120 + rnd() * 120;
  const sun = g.createRadialGradient(sx, sy, 10, sx, sy, 260);
  sun.addColorStop(0, "rgba(255,248,220,0.95)"); sun.addColorStop(1, "rgba(255,248,220,0)");
  g.fillStyle = sun; g.fillRect(0, 0, W, H);

  // dreamy, soft-focus landscape (no drawn characters: the story voice and captions carry it)
  g.filter = "blur(18px)";
  for (let k = 0; k < 6; k++) cloud(g, rnd() * W, 60 + rnd() * 240, 60 + rnd() * 70);
  const hills = ["#cdeedb", "#b5e2c9", "#a2d8bb"];
  hills.forEach((col, k) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, H);
    const base = 480 + k * 75;
    for (let x = 0; x <= W; x += 40) g.lineTo(x, base + Math.sin(x / (220 + k * 70) + seed) * 36);
    g.lineTo(W, H); g.closePath(); g.fill();
  });
  g.filter = "none";
  // floating bokeh lights
  for (let k = 0; k < 22; k++) {
    const bx = rnd() * W, by = rnd() * H, br = 12 + rnd() * 46;
    const glow = g.createRadialGradient(bx, by, 0, bx, by, br);
    const col = ["255,240,200", "255,214,232", "230,220,255", "210,240,255"][k % 4];
    glow.addColorStop(0, `rgba(${col},0.55)`); glow.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = glow; g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill();
  }
  // gentle vignette
  const vig = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  vig.addColorStop(0, "rgba(255,255,255,0)"); vig.addColorStop(1, "rgba(120,90,170,0.18)");
  g.fillStyle = vig; g.fillRect(0, 0, W, H);

  return c.toDataURL("image/jpeg", 0.9);
}

function cloud(g, x, y, r) {
  g.fillStyle = "rgba(255,255,255,0.9)";
  [[0, 0, 1], [0.9, 0.15, 0.8], [-0.9, 0.2, 0.75], [0.4, -0.45, 0.8]].forEach(([dx, dy, s]) => {
    g.beginPath(); g.arc(x + dx * r, y + dy * r, r * s, 0, 7); g.fill();
  });
}

function hash(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h | 0; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
