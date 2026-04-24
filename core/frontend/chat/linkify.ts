/**
 * Post-processes rendered DOM to make file paths and URLs clickable.
 *
 * URLs open in a new browser tab. File paths call the provided callback
 * (typically to open in the right-pane file viewer). Skips content inside
 * <a>, <code>, and <pre> elements to avoid double-wrapping.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"'()\[\]{}]+/;
const FILE_PATH_PATTERN = /(?:\.{1,2}\/[\w.\-/]+|\/[\w.\-/]+)\.[a-zA-Z]{1,10}(?::\d+(?::\d+)?)?/;
const COMBINED_RE = new RegExp(
  `(${URL_PATTERN.source}|${FILE_PATH_PATTERN.source})`,
  "g",
);

const SKIPPED_TAGS = new Set(["a", "code", "pre", "script", "style"]);

function isInsideSkippedElement(node: Node): boolean {
  let el: Node | null = node.parentNode;
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    if (SKIPPED_TAGS.has((el as Element).tagName.toLowerCase())) return true;
    el = el.parentNode;
  }
  return false;
}

function tokenize(
  text: string,
  onOpenFile: (path: string) => void,
): Node[] {
  const nodes: Node[] = [];
  let lastIndex = 0;
  const re = new RegExp(COMBINED_RE.source, "g");
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const matched = match[0]!;

    if (/^https?:\/\//.test(matched)) {
      const a = document.createElement("a");
      a.href = matched;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = matched;
      nodes.push(a);
    } else {
      const filePath = matched.replace(/:\d+(?::\d+)?$/, "");
      const span = document.createElement("span");
      span.className = "chat-file-link";
      span.textContent = matched;
      span.title = `Open ${filePath}`;
      span.addEventListener("click", () => onOpenFile(filePath));
      nodes.push(span);
    }

    lastIndex = match.index + matched.length;
  }

  if (lastIndex < text.length) {
    nodes.push(document.createTextNode(text.slice(lastIndex)));
  }

  return nodes;
}

export function linkifyElement(
  el: HTMLElement,
  onOpenFile: (path: string) => void,
): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    if (!URL_PATTERN.test(text) && !FILE_PATH_PATTERN.test(text)) continue;
    if (isInsideSkippedElement(textNode)) continue;

    const nodes = tokenize(text, onOpenFile);
    if (nodes.length === 1 && nodes[0] instanceof Text) continue;

    const frag = document.createDocumentFragment();
    for (const n of nodes) frag.appendChild(n);
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}
