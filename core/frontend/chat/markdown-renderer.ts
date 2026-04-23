/**
 * Streaming markdown renderer for chat-style surfaces.
 *
 * Wraps MertexMD with the conventional setup: marked/hljs/katex/mermaid
 * globals installed once at module load so MertexMD's handlers find them,
 * plus a mermaid fallback that handles diagram types (gitGraph, etc.) which
 * MertexMD's internal renderer can't mount.
 *
 * Consumers pass their own mermaid theme — the primitive stays neutral so
 * CADE (dark IDE) and Padarax (Scrivener paper) can each style their own.
 */

import { MertexMD, type StreamRenderer } from "mertex.md";
import { marked } from "marked";
import hljs from "highlight.js";
import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";

let globalsInstalled = false;

function installGlobals(): void {
  if (globalsInstalled || typeof window === "undefined") return;
  (window as any).marked = marked;
  (window as any).hljs = hljs;
  (window as any).katex = katex;
  (window as any).renderMathInElement = renderMathInElement;
  (window as any).mermaid = mermaid;
  mermaid.initialize({ startOnLoad: false });
  globalsInstalled = true;
}

installGlobals();

function hashCode(str: string): string {
  if (!str) return "0";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return (hash >>> 0).toString(16);
}

export interface MarkdownRendererOptions {
  /**
   * Overrides passed to `mermaid.initialize`. The primitive calls `initialize`
   * once at module load with `{ startOnLoad: false }`; supplying this option
   * re-initialises with the merged config (theme, themeVariables, etc.).
   */
  mermaidConfig?: Parameters<typeof mermaid.initialize>[0];

  /**
   * Overrides passed to the `MertexMD` constructor. Defaults to
   * `{ breaks: true, gfm: true, highlight: true, katex: true, sanitize: false }`.
   */
  mertexOptions?: ConstructorParameters<typeof MertexMD>[0];

  /**
   * Self-correct hook: called when a diagram fails to render. `fix` receives
   * the broken code, the format ("mermaid"), and the error message, and should
   * return corrected code. If omitted, broken diagrams show an error message.
   */
  selfCorrect?: {
    fix: (code: string, format: string, error: string) => Promise<string>;
    maxRetries?: number;
  };
}

const DEFAULT_MERTEX_OPTIONS: ConstructorParameters<typeof MertexMD>[0] = {
  breaks: true,
  gfm: true,
  highlight: true,
  katex: true,
  sanitize: false,
};

export class MarkdownRenderer {
  readonly mertex: MertexMD;

  constructor(options?: MarkdownRendererOptions) {
    if (options?.mermaidConfig) {
      mermaid.initialize({
        startOnLoad: false,
        ...options.mermaidConfig,
      });
    }
    const mertexOpts = {
      ...(options?.mertexOptions ?? DEFAULT_MERTEX_OPTIONS),
      ...(options?.selfCorrect ? { selfCorrect: options.selfCorrect } : {}),
    };
    this.mertex = new MertexMD(mertexOpts);
  }

  createStream(target: HTMLElement): StreamRenderer {
    return this.mertex.createStreamRenderer(target);
  }

  async render(target: HTMLElement, markdown: string): Promise<void> {
    await this.mertex.renderInElement(target, markdown);
  }

  /**
   * Fallback for mermaid diagrams MertexMD's internal renderer couldn't mount
   * (gitGraph and others need DOM-attached elements). Scans `container` for
   * `.mermaid-placeholder` nodes, recovers the source from `markdown`, and
   * runs `mermaid.run()` against freshly-built pre nodes.
   */
  async renderRemainingDiagrams(
    container: HTMLElement,
    markdown: string,
  ): Promise<void> {
    const placeholders = container.querySelectorAll(".mermaid-placeholder");
    if (placeholders.length === 0) return;

    const codeMap = new Map<string, string>();
    const re = /```mermaid\s*\n([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(markdown)) !== null) {
      const code = match[1]!.split("\n").map((l) => l.trimEnd()).join("\n").trim();
      const id = "MERMAID_" + hashCode(code);
      codeMap.set(id, code);
    }

    for (const placeholder of placeholders) {
      const id = placeholder.getAttribute("data-mermaid-id");
      const code = id ? codeMap.get(id) : null;
      if (!code) continue;

      try {
        const wrapper = document.createElement("div");
        wrapper.className = "mermaid-container";
        const pre = document.createElement("pre");
        pre.className = "mermaid";
        pre.textContent = code;
        wrapper.appendChild(pre);
        placeholder.replaceWith(wrapper);
        await mermaid.run({ nodes: [pre] });
      } catch (err) {
        console.error("Fallback mermaid render failed:", err);
        placeholder.textContent = `Diagram error: ${err}`;
        placeholder.className = "diagram-error";
      }
    }
  }
}

export type { StreamRenderer };
