import hljs from "highlight.js";

/**
 * Split highlighted HTML by newlines while preserving span context across lines.
 * Each output line is valid self-contained HTML.
 */
export function splitHighlightedLines(html: string): string[] {
  const rawLines = html.split("\n");
  const result: string[] = [];
  let openSpans: string[] = [];

  for (const rawLine of rawLines) {
    const prefix = openSpans.join("");

    const tagRegex = /<(\/?)span([^>]*)>/g;
    let m;
    while ((m = tagRegex.exec(rawLine)) !== null) {
      if (m[1] === "/") {
        openSpans.pop();
      } else {
        openSpans.push(`<span${m[2]}>`);
      }
    }

    const suffix = "</span>".repeat(openSpans.length);
    result.push(prefix + rawLine + suffix);
  }

  return result;
}

/**
 * Render code with syntax highlighting in a two-column layout
 * (line numbers | code) with a subtle border separator.
 */
export function renderCode(code: string, language: string): HTMLElement {
  let highlightedHtml: string;

  try {
    if (language !== "plaintext" && hljs.getLanguage(language) !== undefined) {
      highlightedHtml = hljs.highlight(code, { language }).value;
    } else {
      highlightedHtml = hljs.highlightAuto(code).value;
    }
  } catch {
    highlightedHtml = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  const lines = splitHighlightedLines(highlightedHtml);

  const codeView = document.createElement("div");
  codeView.className = "code-view";

  // Line numbers column
  const numbersCol = document.createElement("div");
  numbersCol.className = "code-numbers";
  for (let i = 1; i <= lines.length; i++) {
    const ln = document.createElement("span");
    ln.className = "ln";
    ln.textContent = String(i);
    numbersCol.appendChild(ln);
  }

  // Code column
  const codeCol = document.createElement("div");
  codeCol.className = "code-body";
  for (const lineHtml of lines) {
    const lineEl = document.createElement("div");
    lineEl.className = "code-line";
    lineEl.innerHTML = lineHtml || "\u200b";
    codeCol.appendChild(lineEl);
  }

  codeView.appendChild(numbersCol);
  codeView.appendChild(codeCol);
  return codeView;
}
