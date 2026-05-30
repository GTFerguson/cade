import { marked } from "marked";
import type { TokenizerExtension, RendererExtension, Tokens } from "marked";

/**
 * Obsidian-style callout (admonition) extension for marked.
 *
 * Transforms blockquotes whose first line is a callout marker —
 * `> [!NOTE]`, `> [!WARNING] Custom title`, etc. — into framed callout
 * blocks. CADE renders these as ASCII box-drawing panels (see the
 * `.callout` rules in viewer.css): a thin accent border with the type
 * label notched into the top edge, like a terminal fieldset legend.
 *
 * The fold indicator (`[!NOTE]+` / `[!NOTE]-`) is parsed and preserved on
 * `data-fold` for forward compatibility, but the ASCII frame is static —
 * collapsing is not wired up yet.
 *
 * Inner markdown is parsed recursively, so a callout body may contain
 * lists, code, tables, nested emphasis, and wiki-links.
 */

interface CalloutMeta {
  /** Drives the accent colour via the `.callout-<key>` CSS class. */
  key: string;
  /** Leading marker character. Geometric glyphs only — no emoji. */
  glyph: string;
  /** Default uppercase label when the author gives no custom title. */
  label: string;
}

// Type aliases collapse onto a smaller set of colour keys. The label is
// preserved per-alias so `[!BUG]` still reads "BUG" while sharing the
// danger/red treatment. Unknown types fall back to DEFAULT_META.
const META: Record<string, CalloutMeta> = {
  note: { key: "note", glyph: "▸", label: "NOTE" },
  info: { key: "note", glyph: "▸", label: "INFO" },
  todo: { key: "note", glyph: "▸", label: "TODO" },

  tip: { key: "tip", glyph: "✓", label: "TIP" },
  hint: { key: "tip", glyph: "✓", label: "HINT" },

  success: { key: "success", glyph: "✓", label: "SUCCESS" },
  check: { key: "success", glyph: "✓", label: "CHECK" },
  done: { key: "success", glyph: "✓", label: "DONE" },

  important: { key: "important", glyph: "◆", label: "IMPORTANT" },

  question: { key: "question", glyph: "?", label: "QUESTION" },
  help: { key: "question", glyph: "?", label: "HELP" },
  faq: { key: "question", glyph: "?", label: "FAQ" },

  abstract: { key: "abstract", glyph: "▪", label: "ABSTRACT" },
  summary: { key: "abstract", glyph: "▪", label: "SUMMARY" },
  tldr: { key: "abstract", glyph: "▪", label: "TLDR" },

  warning: { key: "warning", glyph: "△", label: "WARNING" },
  attention: { key: "warning", glyph: "△", label: "ATTENTION" },

  caution: { key: "caution", glyph: "▲", label: "CAUTION" },
  danger: { key: "caution", glyph: "▲", label: "DANGER" },
  error: { key: "caution", glyph: "▲", label: "ERROR" },
  failure: { key: "caution", glyph: "▲", label: "FAILURE" },
  fail: { key: "caution", glyph: "▲", label: "FAIL" },
  bug: { key: "caution", glyph: "▲", label: "BUG" },

  example: { key: "example", glyph: "❯", label: "EXAMPLE" },

  quote: { key: "quote", glyph: '"', label: "QUOTE" },
  cite: { key: "quote", glyph: '"', label: "CITE" },
};

const DEFAULT_META: CalloutMeta = { key: "note", glyph: "▸", label: "NOTE" };

// First line carries the marker; the `> ` lines below it are the body.
// Group 1: type, 2: fold (+/-), 3: rest-of-line title, 4: continuation lines.
const CALLOUT_RULE =
  /^ {0,3}>\s?\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-]?)([^\n]*)(?:\n|$)((?:[ \t]{0,3}>[^\n]*(?:\n|$))*)/;

interface CalloutToken extends Tokens.Generic {
  type: "callout";
  raw: string;
  calloutType: string;
  fold: string;
  meta: CalloutMeta;
  titleTokens: Tokens.Generic[];
  hasTitle: boolean;
  tokens: Tokens.Generic[];
}

export const calloutExtension: TokenizerExtension & RendererExtension = {
  name: "callout",
  level: "block",
  start(src: string) {
    return src.match(/^ {0,3}>\s?\[!/m)?.index;
  },
  tokenizer(src: string) {
    const match = CALLOUT_RULE.exec(src);
    if (!match) return undefined;

    const calloutType = match[1]!.toLowerCase();
    const fold = match[2] ?? "";
    const titleText = (match[3] ?? "").trim();

    // Strip the `> ` quote prefix from each body line to recover the
    // inner markdown, then trim trailing blank lines.
    const bodyMd = (match[4] ?? "")
      .split("\n")
      .map((line) => line.replace(/^[ \t]{0,3}> ?/, ""))
      .join("\n")
      .replace(/\n+$/, "");

    const meta = META[calloutType] ?? { ...DEFAULT_META, label: calloutType.toUpperCase() };

    const token: CalloutToken = {
      type: "callout",
      raw: match[0],
      calloutType,
      fold,
      meta,
      hasTitle: titleText.length > 0,
      // Queue nested tokens through the active lexer so inline content
      // (emphasis, code, wiki-links) is processed in marked's second pass.
      titleTokens: titleText ? this.lexer.inlineTokens(titleText) : [],
      tokens: bodyMd ? this.lexer.blockTokens(bodyMd) : [],
    };
    return token;
  },
  renderer(token) {
    const t = token as CalloutToken;
    const bodyHtml = this.parser.parse(t.tokens);
    const titleHtml = t.hasTitle ? this.parser.parseInline(t.titleTokens) : t.meta.label;
    const fold = t.fold ? ` data-fold="${t.fold}"` : "";

    // Author-supplied titles keep their own casing; the default type labels
    // shout in uppercase (bracket-notation convention).
    const titled = t.hasTitle ? " callout--titled" : "";

    return (
      `<div class="callout callout-${t.meta.key}${titled}" data-callout="${t.calloutType}"${fold}>` +
      `<div class="callout-title">` +
      `<span class="callout-glyph">${t.meta.glyph}</span>` +
      `<span class="callout-label">${titleHtml}</span>` +
      `</div>` +
      `<div class="callout-body">${bodyHtml}</div>` +
      `</div>`
    );
  },
};

let registered = false;

/**
 * Register the callout extension on the shared marked singleton.
 *
 * Idempotent — safe to call from every surface that renders markdown
 * (the file viewer and the chat pane each call it, since they don't share
 * a module that runs the registration).
 */
export function registerCallouts(): void {
  if (registered) return;
  registered = true;
  marked.use({ extensions: [calloutExtension] });
}
