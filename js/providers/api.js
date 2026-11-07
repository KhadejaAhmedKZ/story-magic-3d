// Tiny client for the Story Magic proxy (Cloudflare Worker). No API keys here.
import { CONFIG } from "../config.js";

let offline = false;
export const setOffline = (v) => (offline = v);
export const isOffline = () => offline;

export function deviceId() {
  try {
    let id = localStorage.getItem("sm3d.device");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("sm3d.device", id); }
    return id;
  } catch {
    return (window.__sm3dDevice ||= crypto.randomUUID());
  }
}

export class ApiError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

export async function api(path, { body, method, timeoutMs = 60000, raw = false } = {}) {
  if (offline) throw new ApiError(0, "offline");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(CONFIG.apiBase.replace(/\/$/, "") + path, {
      method: method || (body ? "POST" : "GET"),
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    if (raw && r.ok) return r;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, data.error || "http_" + r.status, data.message);
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, e.name === "AbortError" ? "timeout" : "network", String(e.message || e));
  } finally {
    clearTimeout(t);
  }
}

export async function apiHealthy() {
  try { const h = await api("/api/health", { timeoutMs: 6000 }); return !!h.ok; } catch { return false; }
}
