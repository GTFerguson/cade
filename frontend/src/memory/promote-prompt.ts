import type { MemoryEntry, MemorySymbol } from "./types";

/**
 * Build the structured chat prompt that asks the agent to draft an
 * architecture-doc section from a captured Decision. Designed to land
 * in the chat input as a prefill — the user reviews and submits.
 *
 * Shape grounded in Zhou et al. 2025 §5.2 (CoT four-step rubric) and
 * Su et al. 2026 (rich context to mitigate inference gaps). See
 * `docs/reference/agent-memory-capture.md` §12.1 for full evidence.
 */
export function buildPromotePrompt(memory: MemoryEntry, symbol: MemorySymbol): string {
  const lines: string[] = [];

  lines.push("Promote this Decision to architecture docs.");
  lines.push("");
  lines.push("**Memory:**");
  lines.push(`- title: ${memory.title}`);
  lines.push(`- type: ${memory.type}`);
  lines.push(`- date: ${memory.date}`);
  if (memory.authored_by) lines.push(`- authored by: ${memory.authored_by}`);
  if (memory.tags?.length) lines.push(`- tags: ${memory.tags.join(", ")}`);
  lines.push(`- source uri: http://nkrdn.knowledge/memory#${memory.uuid}`);
  lines.push("");

  lines.push("**Applies to:**");
  lines.push(`- symbol: ${symbol.fqn || symbol.name} (${symbol.kind})`);
  if (symbol.file) {
    const lineRef = symbol.line_start ? `:${symbol.line_start}` : "";
    lines.push(`- file: ${symbol.file}${lineRef}`);
  }
  lines.push("");

  if (memory.body && memory.body.trim()) {
    lines.push("**Rationale (from the memory body):**");
    lines.push(memory.body.trim());
    lines.push("");
  }

  if (memory.rejected_alternatives?.length) {
    lines.push("**Rejected alternatives:**");
    for (const alt of memory.rejected_alternatives) {
      lines.push(`- ${alt.label} — ${alt.reason}`);
    }
    lines.push("");
  }

  if (memory.evidence?.length) {
    lines.push("**Evidence:**");
    for (const ev of memory.evidence) {
      const label = ev.label ? ` (${ev.label})` : "";
      lines.push(`- ${ev.uri}${label}`);
    }
    lines.push("");
  }

  lines.push("**Task:**");
  lines.push("");
  lines.push("1. Pick the most appropriate file under `docs/architecture/`. If none fits, propose creating a new one and stop for confirmation before writing.");
  lines.push("2. Draft a concise architecture-doc section following the four-step structure:");
  lines.push("   - Understand the decision (one paragraph; what was chosen, what it replaces).");
  lines.push("   - Advantages (bullet list of concrete wins; tie each to a constraint or symbol).");
  lines.push("   - Disadvantages (bullet list of trade-offs; honest about what was given up).");
  lines.push("   - Trade-off conclusion (one paragraph; why the chosen path is the right call given the constraints).");
  lines.push("3. Keep it tight — aim for the length a careful human reviewer would write, not exhaustive coverage. ~150–300 words for the section is a reasonable target; cap at 400.");
  lines.push("4. After writing the doc section, append the destination doc path as a wiki-link to the source memory file's `evidence:` frontmatter so retrieval surfaces both. The source memory file is in `.cade/memory/` named after the URI fragment above.");
  lines.push("5. Before each write, show me the diff and wait for approval — this is human-reviewed promotion, not auto-merge.");

  return lines.join("\n");
}
