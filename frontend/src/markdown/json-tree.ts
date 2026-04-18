/**
 * Collapsible JSON tree renderer.
 *
 * Used by MarkdownViewer when fileType === "json" to give edited
 * content files (NPCs, world rooms, etc.) a structured, navigable
 * view rather than raw syntax-highlighted source.
 */

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

const COLLAPSED_KEY = "json-tree-collapsed";

export function renderJsonTree(text: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "json-tree";

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    root.classList.add("json-tree-error");
    root.textContent = `Invalid JSON: ${(e as Error).message}`;
    return root;
  }

  root.appendChild(renderValue(parsed, ""));
  return root;
}

function renderValue(value: JsonValue, path: string): HTMLElement {
  if (value === null) return leaf("null", "json-null");
  if (typeof value === "boolean") return leaf(String(value), "json-bool");
  if (typeof value === "number") return leaf(String(value), "json-number");
  if (typeof value === "string") return leaf(JSON.stringify(value), "json-string");
  if (Array.isArray(value)) return renderArray(value, path);
  return renderObject(value, path);
}

function renderObject(obj: { [k: string]: JsonValue }, path: string): HTMLElement {
  const keys = Object.keys(obj);
  const node = document.createElement("div");
  node.className = "json-node json-object";

  if (keys.length === 0) {
    node.appendChild(leaf("{}", "json-empty"));
    return node;
  }

  const summary = `{${keys.length} ${keys.length === 1 ? "key" : "keys"}}`;
  const header = makeHeader(path, "{", "}", summary);
  const body = document.createElement("div");
  body.className = "json-body";

  for (const key of keys) {
    const row = document.createElement("div");
    row.className = "json-row";

    const keySpan = document.createElement("span");
    keySpan.className = "json-key";
    keySpan.textContent = `${JSON.stringify(key)}: `;
    row.appendChild(keySpan);

    row.appendChild(renderValue(obj[key]!, `${path}.${key}`));
    body.appendChild(row);
  }

  wireToggle(header, body, path);
  node.appendChild(header);
  node.appendChild(body);
  return node;
}

function renderArray(arr: JsonValue[], path: string): HTMLElement {
  const node = document.createElement("div");
  node.className = "json-node json-array";

  if (arr.length === 0) {
    node.appendChild(leaf("[]", "json-empty"));
    return node;
  }

  const summary = `[${arr.length} ${arr.length === 1 ? "item" : "items"}]`;
  const header = makeHeader(path, "[", "]", summary);
  const body = document.createElement("div");
  body.className = "json-body";

  arr.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "json-row";

    const idx = document.createElement("span");
    idx.className = "json-index";
    idx.textContent = `${i}: `;
    row.appendChild(idx);

    row.appendChild(renderValue(item, `${path}[${i}]`));
    body.appendChild(row);
  });

  wireToggle(header, body, path);
  node.appendChild(header);
  node.appendChild(body);
  return node;
}

function makeHeader(
  path: string,
  open: string,
  close: string,
  summary: string,
): HTMLElement {
  const header = document.createElement("span");
  header.className = "json-header";

  const twisty = document.createElement("span");
  twisty.className = "json-twisty";
  twisty.textContent = "▾";

  const bracket = document.createElement("span");
  bracket.className = "json-bracket";
  bracket.textContent = open;

  const summarySpan = document.createElement("span");
  summarySpan.className = "json-summary";
  summarySpan.textContent = ` ${summary} `;

  const closeBracket = document.createElement("span");
  closeBracket.className = "json-bracket json-close-bracket";
  closeBracket.textContent = close;

  header.appendChild(twisty);
  header.appendChild(bracket);
  header.appendChild(summarySpan);
  header.appendChild(closeBracket);
  header.dataset.path = path;
  return header;
}

function wireToggle(header: HTMLElement, body: HTMLElement, path: string): void {
  const collapsed = sessionStorage.getItem(`${COLLAPSED_KEY}:${path}`) === "1";
  if (collapsed) collapse(header, body);

  header.addEventListener("click", () => {
    const isCollapsed = body.classList.contains("collapsed");
    if (isCollapsed) {
      expand(header, body);
      sessionStorage.removeItem(`${COLLAPSED_KEY}:${path}`);
    } else {
      collapse(header, body);
      sessionStorage.setItem(`${COLLAPSED_KEY}:${path}`, "1");
    }
  });
}

function collapse(header: HTMLElement, body: HTMLElement): void {
  body.classList.add("collapsed");
  const twisty = header.querySelector(".json-twisty");
  if (twisty) twisty.textContent = "▸";
  const summary = header.querySelector(".json-summary");
  if (summary) summary.classList.add("visible");
}

function expand(header: HTMLElement, body: HTMLElement): void {
  body.classList.remove("collapsed");
  const twisty = header.querySelector(".json-twisty");
  if (twisty) twisty.textContent = "▾";
  const summary = header.querySelector(".json-summary");
  if (summary) summary.classList.remove("visible");
}

function leaf(text: string, cls: string): HTMLElement {
  const span = document.createElement("span");
  span.className = `json-leaf ${cls}`;
  span.textContent = text;
  return span;
}
