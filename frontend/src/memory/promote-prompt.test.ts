import { describe, it, expect } from "vitest";
import { buildPromotePrompt } from "./promote-prompt";
import type { MemoryEntry, MemorySymbol } from "./types";

const sym: MemorySymbol = {
  uuid: "sym-1",
  name: "AuthService",
  fqn: "backend.auth.auth_service.AuthService",
  kind: "class",
  file: "backend/auth/auth_service.py",
  line_start: 24,
  line_end: 180,
  memories: [],
};

const baseMem: MemoryEntry = {
  uuid: "mem-1",
  type: "decision",
  title: "use Result over throwing",
  body: "Explicit error types beat throwing for auth.",
  date: "2026-01-31",
  authored_by: "agent:claude",
  tags: ["auth", "error-handling"],
};

describe("buildPromotePrompt", () => {
  it("includes the memory title, body, and source URI", () => {
    const out = buildPromotePrompt(baseMem, sym);
    expect(out).toContain("use Result over throwing");
    expect(out).toContain("Explicit error types beat throwing for auth");
    expect(out).toContain("http://nkrdn.knowledge/memory#mem-1");
  });

  it("includes the applies-to symbol with file and line", () => {
    const out = buildPromotePrompt(baseMem, sym);
    expect(out).toContain("backend.auth.auth_service.AuthService (class)");
    expect(out).toContain("backend/auth/auth_service.py:24");
  });

  it("includes rejected alternatives when present", () => {
    const mem: MemoryEntry = {
      ...baseMem,
      rejected_alternatives: [
        { label: "panic!", reason: "too aggressive for recoverable failures" },
        { label: "Box<dyn>", reason: "loses structured info" },
      ],
    };
    const out = buildPromotePrompt(mem, sym);
    expect(out).toContain("panic! — too aggressive");
    expect(out).toContain("Box<dyn> — loses structured info");
  });

  it("includes evidence URIs when present", () => {
    const mem: MemoryEntry = {
      ...baseMem,
      evidence: [
        { kind: "doc", uri: "docs/architecture/error-handling.md" },
        { kind: "external", uri: "https://example.com/post", label: "blog" },
      ],
    };
    const out = buildPromotePrompt(mem, sym);
    expect(out).toContain("docs/architecture/error-handling.md");
    expect(out).toContain("https://example.com/post (blog)");
  });

  it("omits sections that have no data", () => {
    const out = buildPromotePrompt(baseMem, sym);
    expect(out).not.toContain("Rejected alternatives:");
    expect(out).not.toContain("Evidence:");
  });

  it("instructs CoT four-step structure with length cap", () => {
    const out = buildPromotePrompt(baseMem, sym);
    expect(out).toContain("Understand the decision");
    expect(out).toContain("Advantages");
    expect(out).toContain("Disadvantages");
    expect(out).toContain("Trade-off");
    expect(out).toMatch(/cap at \d{2,3}/);
  });

  it("requires diff-and-approve before any write", () => {
    const out = buildPromotePrompt(baseMem, sym);
    expect(out).toContain("show me the diff and wait for approval");
  });

  it("instructs the agent to add the doc path as evidence on the source memory", () => {
    const out = buildPromotePrompt(baseMem, sym);
    expect(out).toContain("evidence:");
    expect(out).toContain(".cade/memory/");
  });
});
