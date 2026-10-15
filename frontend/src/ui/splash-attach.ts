/**
 * Label for a live backend session offered on the start splash. A phone
 * with no saved tabs has no other way to reach a session started elsewhere.
 */

import type { LiveSessionInfo } from "../types";

export function attachOptionLabel(
  session: Pick<LiveSessionInfo, "label" | "projectPath" | "agent" | "attention">,
): string {
  const name = session.label?.trim() || session.projectPath.split("/").pop() || "session";
  const state =
    session.attention === "input" ? " · needs you" : session.attention === "idle" ? " · done" : "";
  return `ATTACH ${name} · ${session.agent}${state}`;
}
