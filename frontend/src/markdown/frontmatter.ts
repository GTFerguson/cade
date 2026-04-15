import type { Frontmatter, ParsedContent } from "./types";

/**
 * Extract YAML frontmatter from markdown content.
 */
export function extractFrontmatter(text: string): ParsedContent {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return { frontmatter: null, content: text };
  }

  const frontmatter = parseYaml(match[1]);
  return { frontmatter, content: match[2] };
}

/**
 * Simple YAML parser for frontmatter.
 * Handles basic key: value pairs, arrays, and nested objects.
 */
export function parseYaml(yaml: string): Frontmatter {
  const result: Frontmatter = {};
  const lines = yaml.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();

    // Handle inline arrays: [item1, item2]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""));
    }
    // Handle quoted strings
    else if (typeof value === "string" && /^["'].*["']$/.test(value)) {
      value = value.slice(1, -1);
    }
    // Handle booleans
    else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    }
    // Handle numbers
    else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
      value = parseFloat(value);
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

// ─── Rendering ──────────────────────────────────────────────────────────

/** Match a whole-value wiki-link: the entire string is a single ``[[X]]``. */
const WIKILINK_WHOLE_RE = /^\s*\[\[([^\]|#\n]+?)(?:\|([^\]\n]*))?\]\]\s*$/;

/** URL pattern — plain http/https. Matches the full trimmed string. */
const URL_RE = /^https?:\/\/\S+$/i;

/** ISO-ish date pattern: ``YYYY-MM-DD`` optionally followed by time. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:]+.*)?$/;

/**
 * Render frontmatter as a typed inspector panel.
 *
 * Visual shape:
 * - Red gutter rail on the left (single source of "this is metadata").
 * - Two-column CSS grid: fixed-width label column, fluid value column.
 * - No header row, no title, no count — the label column does the work.
 *
 * Each value is type-detected and rendered with its own vocabulary:
 * - Whole ``[[X]]`` → ``.ir-relation`` (clickable wiki-link, → prefix).
 * - URL → ``.ir-url`` with ↗ glyph, dotted underline.
 * - Date → ``.ir-date`` (accent-yellow, tabular nums).
 * - Number → ``.ir-number`` (accent-green, tabular nums).
 * - Boolean → ``.ir-bool`` bracket-checkbox.
 * - Comma-joined string → multiple ``.ir-enum`` spans with ``·`` separator
 *   (except the ``title`` field, which always renders whole).
 * - Plain string → ``.ir-scalar``.
 * - Empty / null / [] → ``.ir-empty`` placeholder.
 */
export function renderFrontmatter(frontmatter: Frontmatter): HTMLElement {
  const container = document.createElement("div");
  container.className = "frontmatter";

  const rows = document.createElement("div");
  rows.className = "frontmatter-rows";

  for (const [key, value] of Object.entries(frontmatter)) {
    const row = document.createElement("div");
    row.className = "frontmatter-row";

    const label = document.createElement("div");
    label.className = "frontmatter-label";
    label.textContent = key;

    const valueEl = document.createElement("div");
    valueEl.className = "frontmatter-value";
    renderValue(valueEl, key, value);

    row.appendChild(label);
    row.appendChild(valueEl);
    rows.appendChild(row);
  }

  container.appendChild(rows);
  return container;
}

function renderValue(container: HTMLElement, key: string, value: unknown): void {
  // Empty / null / empty array
  if (
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    container.appendChild(makeEmpty());
    return;
  }

  if (typeof value === "boolean") {
    container.appendChild(makeBool(value));
    return;
  }

  if (typeof value === "number") {
    container.appendChild(makeNumber(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      renderStringValue(container, key, String(item));
    }
    return;
  }

  renderStringValue(container, key, String(value));
}

function renderStringValue(container: HTMLElement, key: string, str: string): void {
  // Whole-value wiki-link → relation pointer.
  const whole = WIKILINK_WHOLE_RE.exec(str);
  if (whole) {
    container.appendChild(makeRelation(whole[1]!, whole[2]));
    return;
  }

  // Title is always rendered whole — commas inside titles are real commas,
  // not enum separators ("Aela, Goddess of Light" shouldn't split).
  if (key.toLowerCase() === "title") {
    container.appendChild(makeTitle(str));
    return;
  }

  const trimmed = str.trim();

  if (URL_RE.test(trimmed)) {
    container.appendChild(makeUrl(trimmed));
    return;
  }

  if (DATE_RE.test(trimmed)) {
    container.appendChild(makeDate(trimmed));
    return;
  }

  // Comma-joined enum list.
  if (str.includes(", ")) {
    for (const part of str.split(", ")) {
      container.appendChild(makeEnum(part.trim()));
    }
    return;
  }

  container.appendChild(makeScalar(str));
}

function makeTitle(text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "ir-title";
  el.textContent = text;
  return el;
}

function makeScalar(text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "ir-scalar";
  el.textContent = text;
  return el;
}

function makeEnum(text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "ir-enum";
  el.textContent = text;
  return el;
}

function makeRelation(target: string, alias: string | undefined): HTMLElement {
  // ``ir-relation`` carries the → prefix + purple/cyan hover;
  // ``wiki-link`` + ``data-path`` hook into the existing
  // attachWikiLinkHandlers so clicks navigate via the same plumbing
  // the body content uses.
  const link = document.createElement("a");
  link.href = "#";
  link.className = "wiki-link ir-relation";
  link.dataset["path"] = target.trim();

  const display = (alias ?? basename(target)).trim();
  const inner = document.createElement("span");
  inner.className = "target";
  inner.textContent = display;
  link.appendChild(inner);
  return link;
}

function makeUrl(url: string): HTMLElement {
  const link = document.createElement("a");
  link.className = "ir-url";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  // Trim protocol for display — trailing slashes kept so users see real url.
  link.textContent = url.replace(/^https?:\/\//i, "");
  return link;
}

function makeNumber(value: number): HTMLElement {
  const el = document.createElement("span");
  el.className = "ir-number";
  el.textContent = String(value);
  return el;
}

function makeDate(text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "ir-date";
  el.textContent = text;
  return el;
}

function makeBool(value: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = `ir-bool ir-bool--${value ? "true" : "false"}`;
  el.textContent = value ? "true" : "false";
  return el;
}

function makeEmpty(): HTMLElement {
  const el = document.createElement("span");
  el.className = "ir-empty";
  el.textContent = "— unset —";
  return el;
}

function basename(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "");
}
