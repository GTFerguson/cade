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

/**
 * Render frontmatter as a styled block.
 */
export function renderFrontmatter(frontmatter: Frontmatter): HTMLElement {
  const container = document.createElement("div");
  container.className = "frontmatter";

  for (const [key, value] of Object.entries(frontmatter)) {
    const row = document.createElement("div");
    row.className = "frontmatter-row";

    const keySpan = document.createElement("span");
    keySpan.className = "frontmatter-key";
    keySpan.textContent = key;

    const separator = document.createElement("span");
    separator.className = "frontmatter-separator";
    separator.textContent = ": ";

    const valueSpan = document.createElement("span");
    valueSpan.className = "frontmatter-value";
    valueSpan.appendChild(renderValueWithWikiLinks(formatFrontmatterValue(value)));

    row.appendChild(keySpan);
    row.appendChild(separator);
    row.appendChild(valueSpan);
    container.appendChild(row);
  }

  return container;
}

/**
 * Format a frontmatter value for display.
 */
export function formatFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

/**
 * Convert a string containing ``[[Page]]`` or ``[[Page|Display]]`` patterns
 * into a DocumentFragment of text nodes interleaved with ``<a class="wiki-link">``
 * anchors. The anchors carry the same shape (``data-path`` attribute) as the
 * marked extension's output, so {@link attachWikiLinkHandlers} picks them up
 * automatically when called on a parent container.
 */
function renderValueWithWikiLinks(value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
    }
    const path = (match[1] ?? "").trim();
    const display = (match[2] ?? match[1] ?? "").trim();
    const link = document.createElement("a");
    link.href = "#";
    link.className = "wiki-link";
    link.dataset["path"] = path;
    link.textContent = display;
    fragment.appendChild(link);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
  }
  return fragment;
}
