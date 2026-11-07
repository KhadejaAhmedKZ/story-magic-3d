// "Download my movie": plays the movie once while drawing the stage to a canvas and
// recording canvas + mixed audio (narration + music) with MediaRecorder → MP4 (or WebM).

export function canRecord(movie) {
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
    return { ok: false, why: "This browser can't save movies. Try Chrome or Edge on a computer." };
  }
  const remote = movie.items.some(
    (it) => it.clip && !/^(data:|blob:)/.test(it.clip.src)
  ) || (movie.bg && !/^(data:|blob:)/.test(movie.bg));
  if (remote) return { ok: false, why: "Some clips can only be watched here, not saved." };
  return { ok: true, speechOnly: movie.items.some((it) => it.narration?.kind === "speech") };
}

function pickMime() {
  const c = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return c.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}

export function recordMovie(player, onProgress) {
  return new Promise((resolve, reject) => {
    const W = 1280, H = 720;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    player.recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const mime = pickMime();
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    } catch (e) {
      return reject(e);
    }
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      cancelAnimationFrame(raf);
      const type = rec.mimeType || mime || "video/webm";
      resolve({ blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm" });
    };

    let raf;
    const draw = () => {
      g.fillStyle = "#1d1630";
      g.fillRect(0, 0, W, H);
      for (const layer of player.layers()) {
        const op = parseFloat(getComputedStyle(layer).opacity) || 0;
        if (op <= 0.01) continue;
        g.save();
        g.globalAlpha = op;
        const media = layer.querySelector("video, img");
        if (media) {
          const m = new DOMMatrixReadOnly(getComputedStyle(layer).transform === "none" ? undefined : getComputedStyle(layer).transform);
          drawCover(g, media, W, H, m.a || 1, m.e, m.f, layer.clientWidth);
        } else {
          drawCard(g, layer.querySelector(".card"), W, H);
        }
        g.restore();
      }
      if (player.els.stage.classList.contains("calm")) { g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(0, 0, W, H); }
      drawCaption(g, player.capWords, player.els.captions.classList.contains("on"), W, H);
      raf = requestAnimationFrame(draw);
    };

    const onItem = (i) => onProgress?.(i / player.items.length);
    const onEnd = () => {
      player.off("ended", onEnd); player.off("item", onItem);
      setTimeout(() => rec.state !== "inactive" && rec.stop(), 1800);
    };
    player.on("ended", onEnd);
    player.on("item", onItem);
    draw();
    rec.start(1000);
    player.replay();
  });
}

function drawCover(g, el, W, H, scale = 1, tx = 0, ty = 0, domW = W) {
  const iw = el.videoWidth || el.naturalWidth, ih = el.videoHeight || el.naturalHeight;
  if (!iw || !ih) return;
  const k = W / (domW || W);
  const s = Math.max(W / iw, H / ih) * scale;
  const dw = iw * s, dh = ih * s;
  try { g.drawImage(el, (W - dw) / 2 + tx * k, (H - dh) / 2 + ty * k, dw, dh); } catch {}
}

function drawCard(g, card, W, H) {
  if (!card) return;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#ffd6e8"); grad.addColorStop(0.5, "#e5d9ff"); grad.addColorStop(1, "#cfe9ff");
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const bgImg = card._bgImg || (card._bgImg = (() => {
    const m = /url\("(.+)"\)/.exec(card.style.getPropertyValue("--bg") || "");
    if (!m) return null;
    const i = new Image(); i.src = m[1]; return i;
  })());
  if (bgImg?.complete && bgImg.naturalWidth) {
    g.save(); g.filter = "blur(14px)"; g.globalAlpha *= 0.45;
    drawCover(g, bgImg, W, H, 1.1); g.restore();
  }
  const h1 = card.querySelector("h1")?.textContent || "";
  const p = card.querySelector("p")?.textContent || "";
  const emoji = card.querySelector(".card-emoji")?.textContent || "";
  g.textAlign = "center";
  g.fillStyle = "#5b3b8c";
  g.font = "64px 'Baloo 2', system-ui";
  g.fillText(emoji, W / 2, H / 2 - 110);
  g.font = "800 68px 'Baloo 2', system-ui";
  wrap(g, h1, W / 2, H / 2, W - 200, 74);
  g.fillStyle = "#8a5fb8";
  g.font = "600 38px 'Baloo 2', system-ui";
  g.fillText(p, W / 2, H / 2 + 140);
}

function wrap(g, text, x, y, maxW, lh) {
  const words = text.split(" "); const lines = []; let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  lines.push(line);
  const y0 = y - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => g.fillText(l, x, y0 + i * lh));
}

function drawCaption(g, words, on, W, H) {
  if (!on || !words?.length) return;
  g.font = "700 28px 'Baloo 2', system-ui";
  const maxW = W - 300;
  const lines = [[]]; let lw = 0;
  for (const w of words) {
    const ww = g.measureText(w.el.textContent + " ").width;
    if (lw + ww > maxW && lines.at(-1).length) { lines.push([]); lw = 0; }
    lines.at(-1).push({ w, ww }); lw += ww;
  }
  const lh = 36, boxH = lines.length * lh + 22, y0 = H - boxH - 24;
  g.fillStyle = "rgba(40,24,70,0.42)";
  roundRect(g, 130, y0, W - 260, boxH, 22); g.fill();
  g.textAlign = "left";
  lines.forEach((ln, li) => {
    const total = ln.reduce((s, x) => s + x.ww, 0);
    let x = (W - total) / 2;
    for (const { w, ww } of ln) {
      g.fillStyle = w.el.classList.contains("now") ? "#ffe17a" : w.el.classList.contains("said") ? "#ffffff" : "rgba(255,255,255,0.75)";
      g.fillText(w.el.textContent, x, y0 + 36 + li * lh);
      x += ww;
    }
  });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
