/**
 * Browser notification for an agent that needs the user, shown only when
 * the page is not in front of them. Covers a backgrounded tab on desktop
 * or Android without any push setup; push (see push.ts) covers a closed
 * one.
 */

import type { AttentionState } from "../types";

export function attentionTitle(tabName: string, state: Exclude<AttentionState, null>): string {
  return state === "input" ? `${tabName}: needs you` : `${tabName}: done`;
}

export function notifyAttention(
  tabName: string,
  state: Exclude<AttentionState, null>,
  message: string | null,
  onClick: () => void,
): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    const n = new Notification(attentionTitle(tabName, state), {
      body: (message ?? "").slice(0, 200),
      tag: `cade-${tabName}`,
    });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
