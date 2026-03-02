/**
 * @vitest-environment node
 *
 * Tests for remote profile data wiring, browse navigation,
 * project creation, and shared UI utilities.
 *
 * Every pure function extracted from the UI menus is tested here
 * to ensure form inputs reach their destinations correctly.
 */

import { describe, it, expect } from "vitest";
import {
  buildSshTunnelProfile,
  buildTunnelArgs,
  computeParentPath,
  filterDirectories,
  buildSavedProject,
  sortProjectsByLastUsed,
  computeFileCreationBasePath,
  wrapIndex,
  getProfileDisplayMeta,
} from "./profile-utils";
import type { RemoteProfile, SavedProject } from "./types";
import type { FileNode } from "../types";

const STUB_ID = "test-id-123";
const stubGenerateId = () => STUB_ID;

// ─── Profile Building ───────────────────────────────────────────────

describe("buildSshTunnelProfile", () => {
  const baseInputs = {
    name: "glann",
    host: "3.254.73.120",
    user: "ubuntu",
    keyPath: "~/.ssh/id_ed25519",
  };

  it("maps all SSH inputs to the correct profile fields", () => {
    const profile = buildSshTunnelProfile(baseInputs, stubGenerateId);

    expect(profile.name).toBe("glann");
    expect(profile.sshHost).toBe("3.254.73.120");
    expect(profile.sshUser).toBe("ubuntu");
    expect(profile.sshKeyPath).toBe("~/.ssh/id_ed25519");
  });

  it("sets connectionType to ssh-tunnel", () => {
    const profile = buildSshTunnelProfile(baseInputs, stubGenerateId);
    expect(profile.connectionType).toBe("ssh-tunnel");
  });

  it("defaults both ports to 3030", () => {
    const profile = buildSshTunnelProfile(baseInputs, stubGenerateId);
    expect(profile.localPort).toBe(3030);
    expect(profile.remotePort).toBe(3030);
  });

  it("constructs URL from localPort", () => {
    const profile = buildSshTunnelProfile(baseInputs, stubGenerateId);
    expect(profile.url).toBe("http://localhost:3030");
  });

  it("generates an ID when none provided", () => {
    const profile = buildSshTunnelProfile(baseInputs, stubGenerateId);
    expect(profile.id).toBe(STUB_ID);
  });

  it("uses existing ID when editing a profile", () => {
    const inputs = { ...baseInputs, id: "existing-id" };
    const profile = buildSshTunnelProfile(inputs, stubGenerateId);
    expect(profile.id).toBe("existing-id");
  });

  it("preserves lastUsed when provided", () => {
    const inputs = { ...baseInputs, lastUsed: 1700000000 };
    const profile = buildSshTunnelProfile(inputs, stubGenerateId);
    expect(profile.lastUsed).toBe(1700000000);
  });

  it("omits lastUsed when not provided", () => {
    const profile = buildSshTunnelProfile(baseInputs, stubGenerateId);
    expect(profile).not.toHaveProperty("lastUsed");
  });

  it("does not lose the host when user contains @ symbol", () => {
    const inputs = { ...baseInputs, user: "deploy@team", host: "10.0.0.1" };
    const profile = buildSshTunnelProfile(inputs, stubGenerateId);
    expect(profile.sshHost).toBe("10.0.0.1");
    expect(profile.sshUser).toBe("deploy@team");
  });

  it("preserves key paths with spaces", () => {
    const inputs = { ...baseInputs, keyPath: "C:\\Users\\My User\\.ssh\\key" };
    const profile = buildSshTunnelProfile(inputs, stubGenerateId);
    expect(profile.sshKeyPath).toBe("C:\\Users\\My User\\.ssh\\key");
  });
});

// ─── Tunnel Args ────────────────────────────────────────────────────

describe("buildTunnelArgs", () => {
  it("maps all profile fields to tunnel invocation args", () => {
    const profile: RemoteProfile = {
      id: "test",
      name: "glann",
      url: "http://localhost:3030",
      connectionType: "ssh-tunnel",
      sshHost: "3.254.73.120",
      sshUser: "ubuntu",
      sshKeyPath: "~/.ssh/id_ed25519",
      localPort: 3030,
      remotePort: 3030,
    };

    const args = buildTunnelArgs(profile);

    expect(args.sshHost).toBe("3.254.73.120");
    expect(args.sshUser).toBe("ubuntu");
    expect(args.sshKeyPath).toBe("~/.ssh/id_ed25519");
    expect(args.localPort).toBe(3030);
    expect(args.remotePort).toBe(3030);
  });

  it("passes null for missing sshUser", () => {
    const profile: RemoteProfile = {
      id: "test",
      name: "test",
      url: "http://localhost:3030",
      connectionType: "ssh-tunnel",
      sshHost: "10.0.0.1",
      localPort: 3030,
      remotePort: 3030,
    };

    const args = buildTunnelArgs(profile);
    expect(args.sshUser).toBeNull();
  });

  it("passes null for missing sshKeyPath", () => {
    const profile: RemoteProfile = {
      id: "test",
      name: "test",
      url: "http://localhost:3030",
      connectionType: "ssh-tunnel",
      sshHost: "10.0.0.1",
      sshUser: "root",
      localPort: 3030,
      remotePort: 3030,
    };

    const args = buildTunnelArgs(profile);
    expect(args.sshKeyPath).toBeNull();
  });

  it("defaults ports to 3030 when missing from profile", () => {
    const profile: RemoteProfile = {
      id: "test",
      name: "test",
      url: "http://localhost:3030",
      connectionType: "ssh-tunnel",
      sshHost: "10.0.0.1",
    };

    const args = buildTunnelArgs(profile);
    expect(args.localPort).toBe(3030);
    expect(args.remotePort).toBe(3030);
  });

  it("round-trips: buildProfile → buildTunnelArgs preserves all SSH data", () => {
    const inputs = {
      name: "production",
      host: "ec2-1-2-3-4.eu-west-1.compute.amazonaws.com",
      user: "deploy",
      keyPath: "/home/dev/.ssh/prod_key.pem",
    };

    const profile = buildSshTunnelProfile(inputs, stubGenerateId);
    const args = buildTunnelArgs(profile);

    expect(args.sshHost).toBe(inputs.host);
    expect(args.sshUser).toBe(inputs.user);
    expect(args.sshKeyPath).toBe(inputs.keyPath);
    expect(args.localPort).toBe(3030);
    expect(args.remotePort).toBe(3030);
  });
});

// ─── Browse Navigation ──────────────────────────────────────────────

describe("computeParentPath", () => {
  it("goes up one level from a nested path", () => {
    expect(computeParentPath("/home/ubuntu/projects")).toBe("/home/ubuntu");
  });

  it("goes up to root from a single-segment path", () => {
    expect(computeParentPath("/home")).toBe("/");
  });

  it("stays at root when already at root", () => {
    expect(computeParentPath("/")).toBe("/");
  });

  it("handles paths with trailing slashes", () => {
    expect(computeParentPath("/home/ubuntu/")).toBe("/home");
  });

  it("handles deeply nested paths", () => {
    expect(computeParentPath("/a/b/c/d/e")).toBe("/a/b/c/d");
  });

  it("handles empty string as root", () => {
    expect(computeParentPath("")).toBe("/");
  });

  it("stays at ~ when already at home directory", () => {
    expect(computeParentPath("~")).toBe("~");
  });

  it("goes up to ~ from a subdirectory of home", () => {
    expect(computeParentPath("~/projects")).toBe("~");
  });

  it("navigates within ~-prefixed paths correctly", () => {
    expect(computeParentPath("~/projects/cade")).toBe("~/projects");
  });

  it("handles ~/single-dir path", () => {
    expect(computeParentPath("~/Documents")).toBe("~");
  });
});

// ─── Directory Filtering ────────────────────────────────────────────

describe("filterDirectories", () => {
  const entries: FileNode[] = [
    { name: "src", path: "/src", type: "directory" },
    { name: "main.ts", path: "/main.ts", type: "file" },
    { name: "docs", path: "/docs", type: "directory" },
    { name: "README.md", path: "/README.md", type: "file" },
    { name: "tests", path: "/tests", type: "directory" },
  ];

  it("filters to directories only", () => {
    const dirs = filterDirectories(entries);
    expect(dirs).toHaveLength(3);
    expect(dirs.map((d) => d.name)).toEqual(["src", "docs", "tests"]);
  });

  it("returns empty array when no directories", () => {
    const files: FileNode[] = [
      { name: "a.ts", path: "/a.ts", type: "file" },
      { name: "b.ts", path: "/b.ts", type: "file" },
    ];
    expect(filterDirectories(files)).toEqual([]);
  });

  it("returns all entries when all are directories", () => {
    const dirs: FileNode[] = [
      { name: "a", path: "/a", type: "directory" },
      { name: "b", path: "/b", type: "directory" },
    ];
    expect(filterDirectories(dirs)).toHaveLength(2);
  });

  it("handles empty array", () => {
    expect(filterDirectories([])).toEqual([]);
  });
});

// ─── Project Building ───────────────────────────────────────────────

describe("buildSavedProject", () => {
  it("creates a project with name, path, and generated ID", () => {
    const project = buildSavedProject("my-app", "/home/ubuntu/my-app", stubGenerateId);

    expect(project.id).toBe(STUB_ID);
    expect(project.name).toBe("my-app");
    expect(project.path).toBe("/home/ubuntu/my-app");
  });

  it("sets lastUsed to current timestamp", () => {
    const before = Date.now();
    const project = buildSavedProject("test", "/test", stubGenerateId);
    const after = Date.now();

    expect(project.lastUsed).toBeGreaterThanOrEqual(before);
    expect(project.lastUsed).toBeLessThanOrEqual(after);
  });

  it("preserves path exactly as given", () => {
    const project = buildSavedProject("proj", "/home/user/My Project", stubGenerateId);
    expect(project.path).toBe("/home/user/My Project");
  });
});

// ─── Project Sorting ────────────────────────────────────────────────

describe("sortProjectsByLastUsed", () => {
  it("sorts most recently used first", () => {
    const projects: SavedProject[] = [
      { id: "1", name: "old", path: "/old", lastUsed: 100 },
      { id: "2", name: "new", path: "/new", lastUsed: 300 },
      { id: "3", name: "mid", path: "/mid", lastUsed: 200 },
    ];

    const sorted = sortProjectsByLastUsed(projects);
    expect(sorted.map((p) => p.name)).toEqual(["new", "mid", "old"]);
  });

  it("does not mutate the original array", () => {
    const projects: SavedProject[] = [
      { id: "1", name: "a", path: "/a", lastUsed: 100 },
      { id: "2", name: "b", path: "/b", lastUsed: 200 },
    ];

    const sorted = sortProjectsByLastUsed(projects);
    expect(sorted).not.toBe(projects);
    expect(projects[0]!.name).toBe("a");
  });

  it("handles missing lastUsed (treats as 0)", () => {
    const projects: SavedProject[] = [
      { id: "1", name: "no-date", path: "/a" },
      { id: "2", name: "has-date", path: "/b", lastUsed: 100 },
    ];

    const sorted = sortProjectsByLastUsed(projects);
    expect(sorted[0]!.name).toBe("has-date");
  });

  it("handles empty array", () => {
    expect(sortProjectsByLastUsed([])).toEqual([]);
  });
});

// ─── File Creation Base Path ────────────────────────────────────────

describe("computeFileCreationBasePath", () => {
  it("adds trailing slash for directories", () => {
    expect(computeFileCreationBasePath("src/components", "directory")).toBe(
      "src/components/"
    );
  });

  it("extracts parent directory for files", () => {
    expect(computeFileCreationBasePath("src/main.ts", "file")).toBe("src/");
  });

  it("returns empty string when nothing selected", () => {
    expect(computeFileCreationBasePath(null, null)).toBe("");
  });

  it("handles root-level files", () => {
    expect(computeFileCreationBasePath("README.md", "file")).toBe("");
  });

  it("handles deeply nested files", () => {
    expect(
      computeFileCreationBasePath("src/ui/components/Button.ts", "file")
    ).toBe("src/ui/components/");
  });

  it("handles root-level directories", () => {
    expect(computeFileCreationBasePath("src", "directory")).toBe("src/");
  });
});

// ─── Profile Display Meta ──────────────────────────────────────────

describe("getProfileDisplayMeta", () => {
  it("shows user@host for SSH tunnel profiles", () => {
    const profile: RemoteProfile = {
      id: "1",
      name: "clann",
      url: "http://localhost:3030",
      connectionType: "ssh-tunnel",
      sshHost: "52.30.205.70",
      sshUser: "ubuntu",
      sshKeyPath: "~/.ssh/id_ed25519",
      localPort: 3030,
      remotePort: 3030,
    };

    expect(getProfileDisplayMeta(profile)).toBe("ubuntu@52.30.205.70");
  });

  it("shows host only when sshUser is missing", () => {
    const profile: RemoteProfile = {
      id: "1",
      name: "test",
      url: "http://localhost:3030",
      connectionType: "ssh-tunnel",
      sshHost: "10.0.0.1",
      localPort: 3030,
      remotePort: 3030,
    };

    expect(getProfileDisplayMeta(profile)).toBe("10.0.0.1");
  });

  it("shows URL for direct connections", () => {
    const profile: RemoteProfile = {
      id: "1",
      name: "direct",
      url: "http://52.30.205.70/cade/",
      connectionType: "direct",
    };

    expect(getProfileDisplayMeta(profile)).toBe("http://52.30.205.70/cade/");
  });
});

// ─── Index Wrapping ─────────────────────────────────────────────────

describe("wrapIndex", () => {
  it("wraps forward past end to beginning", () => {
    expect(wrapIndex(4, 1, 5)).toBe(0);
  });

  it("wraps backward past beginning to end", () => {
    expect(wrapIndex(0, -1, 5)).toBe(4);
  });

  it("moves forward normally within bounds", () => {
    expect(wrapIndex(2, 1, 5)).toBe(3);
  });

  it("moves backward normally within bounds", () => {
    expect(wrapIndex(2, -1, 5)).toBe(1);
  });

  it("returns 0 for empty list", () => {
    expect(wrapIndex(0, 1, 0)).toBe(0);
  });

  it("handles single-item list", () => {
    expect(wrapIndex(0, 1, 1)).toBe(0);
    expect(wrapIndex(0, -1, 1)).toBe(0);
  });

  it("handles multi-step jumps", () => {
    expect(wrapIndex(0, 3, 5)).toBe(3);
    expect(wrapIndex(0, -2, 5)).toBe(3);
  });
});
