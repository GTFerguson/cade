import type { TokenizerExtension, RendererExtension } from "marked";

/**
 * Wiki-link extension for marked.
 * Transforms [[path]] and [[path|display]] syntax into clickable links.
 */
export const wikiLinkExtension: TokenizerExtension & RendererExtension = {
  name: "wikiLink",
  level: "inline",
  start(src: string) {
    return src.indexOf("[[");
  },
  tokenizer(src: string) {
    const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
    if (match && match[1] !== undefined) {
      const path = match[1].trim();
      const display = match[2]?.trim() ?? path;
      return {
        type: "wikiLink",
        raw: match[0],
        path,
        display,
      };
    }
    return undefined;
  },
  renderer(token) {
    const t = token as unknown as { path: string; display: string };
    const escapedPath = t.path.replace(/"/g, "&quot;");
    const escapedDisplay = t.display
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<a href="#" class="wiki-link" data-path="${escapedPath}">${escapedDisplay}</a>`;
  },
};

/**
 * Resolve a wiki-link path.
 *
 * Two cases:
 * - **Path-style** (``[[Folder/Subfolder/Page]]`` or ``[[/Folder/Page]]``):
 *   resolved as **vault-relative** — the link describes its own location and
 *   is *not* joined to the current file's directory. The export pipeline
 *   pre-rewrites bare links to this form, so this is the common path.
 * - **Bare basename** (``[[Page]]``): falls back to sibling-relative
 *   resolution against the current file's directory. This is the legacy
 *   behaviour and only kicks in for hand-typed links the preprocessor hasn't
 *   touched.
 */
export function resolveWikiLink(linkPath: string, currentPath: string | null): string {
  let targetPath = linkPath;

  if (targetPath.endsWith("/")) {
    targetPath = `${targetPath}README.md`;
  } else {
    const lastSlash = targetPath.lastIndexOf("/");
    const filename = lastSlash === -1 ? targetPath : targetPath.slice(lastSlash + 1);
    if (!filename.includes(".") || filename.startsWith(".")) {
      targetPath = `${targetPath}.md`;
    }
  }

  // Path-style links (anything containing /) are vault-relative. Strip any
  // leading slashes so callers get a clean repo-relative path.
  if (targetPath.includes("/")) {
    return normalizePath(targetPath.replace(/^\/+/, ""));
  }

  // Bare basename: legacy sibling-relative fallback.
  if (currentPath != null) {
    const lastSlash = currentPath.lastIndexOf("/");
    if (lastSlash !== -1) {
      const currentDir = currentPath.slice(0, lastSlash + 1);
      targetPath = currentDir + targetPath;
    }
  }

  return normalizePath(targetPath);
}

/**
 * Resolve a standard markdown link href relative to the current file.
 *
 * Unlike resolveWikiLink (which treats all paths containing / as vault-relative),
 * this respects the conventional markdown semantics:
 *   - /abs/path  → strip leading slash, treat as project-root-relative
 *   - ./rel or ../rel → resolve relative to the current file's directory
 *   - bare/path  → treat as project-root-relative (vault-relative)
 */
export function resolveMarkdownLinkHref(href: string, currentPath: string | null): string {
  if (href.startsWith("/")) {
    return normalizePath(href.slice(1));
  }
  if ((href.startsWith("./") || href.startsWith("../")) && currentPath !== null) {
    const dir = currentPath.slice(0, currentPath.lastIndexOf("/") + 1);
    return normalizePath(dir + href);
  }
  return normalizePath(href);
}

/**
 * Normalize a path by resolving . and .. segments.
 */
export function normalizePath(path: string): string {
  const parts = path.split("/");
  const result: string[] = [];

  for (const part of parts) {
    if (part === "..") {
      result.pop();
    } else if (part !== "." && part !== "") {
      result.push(part);
    }
  }

  return result.join("/");
}

/**
 * Attach click handlers to wiki links in a container.
 */
export function attachWikiLinkHandlers(
  container: HTMLElement,
  currentPath: string | null,
  onLinkClick: (targetPath: string) => void
): void {
  const wikiLinks = container.querySelectorAll(".wiki-link");

  wikiLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const linkPath = (link as HTMLElement).dataset["path"];
      if (linkPath != null) {
        const targetPath = resolveWikiLink(linkPath, currentPath);
        onLinkClick(targetPath);
      }
    });
  });
}
