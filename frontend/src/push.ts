/**
 * Web Push on the client: service worker registration and the subscribe /
 * unsubscribe flow against the backend's VAPID key. Push is the only way a
 * phone with CADE closed learns that an agent is waiting.
 */

import { basePath } from "./config/config";

export type PushState = "unsupported" | "denied" | "off" | "on";

/** Decode the VAPID public key the way PushManager.subscribe wants it. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

/**
 * Register the service worker in production builds. Dev builds skip it so
 * Vite's module graph is never shadowed by a cached shell.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register(`${basePath}/sw.js`, { scope: `${basePath}/` })
    .catch((err) => console.warn("Service worker registration failed:", err));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    // getRegistration resolves to undefined when nothing is registered
    // (dev builds); `ready` would wait forever.
    const reg = await navigator.serviceWorker.getRegistration(`${basePath}/`);
    return reg ?? null;
  } catch {
    return null;
  }
}

async function api<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const init: RequestInit = { method: "GET", credentials: "include" };
    if (body !== undefined) {
      init.method = "POST";
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${basePath}/api/push/${path}`, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  if (!reg) return "unsupported";
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const status = await api<{ available: boolean; publicKey: string | null }>("status");
  if (!status?.available || !status.publicKey) return "unsupported";
  const reg = await registration();
  if (!reg) return "unsupported";

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(status.publicKey) as BufferSource,
    });
  }
  const saved = await api("subscribe", {
    subscription: sub.toJSON(),
    device: navigator.userAgent.slice(0, 80),
  });
  return saved ? "on" : "off";
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  if (!reg) return "unsupported";
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api("unsubscribe", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return "off";
}
