// Video provider: "proxy" (MiniMax Hailuo image-to-video via the Worker) or "none".
// sceneVideo() resolves to { type: "video", src: blob:URL, local: true } or null (→ use the still).
// It never throws, retries a failed clip once, and keeps going after the 2-minute start so a
// late clip can still swap in before its scene plays.

import { CONFIG } from "../config.js";
import { api } from "./api.js";

const POLL_MS = 4000;
const GIVE_UP_MS = 7 * 60 * 1000;

export async function sceneVideo(i, still, token, onStatus = () => {}) {
  if (CONFIG.videoProvider !== "proxy" || !token || still?.source !== "proxy") return null;
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      onStatus("queued", attempt);
      const { taskId } = await api("/api/video", { body: { token, scene: i, firstFrame: still.src }, timeoutMs: 45000 });
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
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
