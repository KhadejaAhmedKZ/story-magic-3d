// Video provider: "proxy" (MiniMax Hailuo image-to-video via the Worker) or "none".
// sceneVideo() resolves to { type: "video", src: blob:URL, local: true } or null (→ use the still).
// It never throws, retries a failed clip once, and keeps going after the 2-minute start so a
// late clip can still swap in before its scene plays.

import { CONFIG } from "../config.js";
import { api } from "./api.js";

const POLL_MS = 5000;
const GIVE_UP_MS = 7 * 60 * 1000;

export async function sceneVideo(i, still, token, onStatus = () => {}) {
  if (CONFIG.videoProvider !== "proxy" || !token || still?.source !== "proxy") return null;
  const t0 = Date.now();
  let failures = 0;
  for (let attempt = 1; failures < 2 && attempt <= 8; attempt++) {
    try {
      onStatus("queued", attempt);
      const taskId = await submit(i, still, token);
      while (Date.now() - t0 < GIVE_UP_MS) {
        await sleep(POLL_MS);
        let st;
        try {
          st = await api(`/api/video?token=${enc(token)}&task=${enc(taskId)}`, { timeoutMs: 20000 });
        } catch (e) {
          if (e.status === 401 || e.status === 403) throw e;
          continue; // network blip: keep polling
        }
        onStatus(st.status, attempt);
        if (st.status === "Success") {
          const r = await api(`/api/file?token=${enc(token)}&task=${enc(taskId)}`, { raw: true, timeoutMs: 90000 });
          const blob = await r.blob();
          if (!blob.size) throw new Error("empty clip");
          return { type: "video", src: URL.createObjectURL(blob), local: true, taskId };
        }
        if (st.status === "Fail") throw Object.assign(new Error("clip failed"), { code: st.moderated ? "moderated" : "fail" });
      }
      return null;
    } catch (e) {
      console.warn(`[video] scene ${i + 1} attempt ${attempt}:`, e.code || "", e.message);
      if (["story_limit", "balance_low", "budget_limit"].includes(e.code)) return null;
      failures++; // a real failure (bad clip / moderation): retry once
    }
  }
  return null;
}

// Submit a clip; if MiniMax says "too many requests this minute", wait and try again
// (6 s, 12 s, 18 s …) instead of giving up on the scene.
async function submit(i, still, token) {
  for (let k = 1; ; k++) {
    try {
      const { taskId } = await api("/api/video", { body: { token, scene: i, firstFrame: still.src }, timeoutMs: 45000 });
      return taskId;
    } catch (e) {
      const rateLimited = e.status === 429 && e.code !== "story_limit";
      if (!rateLimited || k >= 6) throw e;
      console.info(`[video] scene ${i + 1}: rate limited, waiting ${6 * k}s`);
      await sleep(6000 * k + Math.random() * 1500);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
