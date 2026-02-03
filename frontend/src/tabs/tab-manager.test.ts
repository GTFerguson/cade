/**
 * @vitest-environment node
 *
 * Tests for auth dialog deduplication logic.
 *
 * When multiple tabs share the same remote profile and one tab reconnects
 * successfully while another fires auth-failed, the stale tab should be
 * closed silently instead of showing a redundant auth dialog.
 */

import { describe, it, expect } from "vitest";
import { hasConnectedProfileTab } from "./tab-manager";

function tab(id: string, profileId: string | undefined, connected: boolean) {
  const t: { id: string; remoteProfileId?: string; isConnected: boolean } = {
    id,
    isConnected: connected,
  };
  if (profileId !== undefined) {
    t.remoteProfileId = profileId;
  }
  return t;
}

describe("hasConnectedProfileTab", () => {
  it("returns false when no other tabs exist", () => {
    const tabs = [tab("tab-1", "profile-a", false)];
    expect(hasConnectedProfileTab(tabs, "tab-1", "profile-a")).toBe(false);
  });

  it("returns false when sibling tab exists but is disconnected", () => {
    const tabs = [
      tab("tab-1", "profile-a", false),
      tab("tab-2", "profile-a", false),
    ];
    expect(hasConnectedProfileTab(tabs, "tab-1", "profile-a")).toBe(false);
  });

  it("returns true when sibling tab on same profile is connected", () => {
    const tabs = [
      tab("tab-1", "profile-a", false),
      tab("tab-2", "profile-a", true),
    ];
    expect(hasConnectedProfileTab(tabs, "tab-1", "profile-a")).toBe(true);
  });

  it("ignores connected tabs on a different profile", () => {
    const tabs = [
      tab("tab-1", "profile-a", false),
      tab("tab-2", "profile-b", true),
    ];
    expect(hasConnectedProfileTab(tabs, "tab-1", "profile-a")).toBe(false);
  });

  it("does not match the tab against itself", () => {
    const tabs = [tab("tab-1", "profile-a", true)];
    expect(hasConnectedProfileTab(tabs, "tab-1", "profile-a")).toBe(false);
  });

  it("works with multiple profiles and mixed states", () => {
    const tabs = [
      tab("tab-1", "profile-a", false),
      tab("tab-2", "profile-b", true),
      tab("tab-3", "profile-a", true),
      tab("tab-4", "profile-c", false),
    ];
    // tab-1 should see tab-3 as connected sibling
    expect(hasConnectedProfileTab(tabs, "tab-1", "profile-a")).toBe(true);
    // tab-2 has no other profile-b tabs
    expect(hasConnectedProfileTab(tabs, "tab-2", "profile-b")).toBe(false);
    // tab-4 has no connected profile-c siblings
    expect(hasConnectedProfileTab(tabs, "tab-4", "profile-c")).toBe(false);
  });

  it("handles tabs with no profile ID gracefully", () => {
    const tabs = [
      tab("tab-1", undefined, true),
      tab("tab-2", "profile-a", false),
    ];
    expect(hasConnectedProfileTab(tabs, "tab-2", "profile-a")).toBe(false);
  });
});
