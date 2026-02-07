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
 * Resolve a wiki-link path relative to the current file.
 */
export function resolveWikiLink(linkPath: string, currentPath: string | null): string {
  let targetPath = linkPath;

  // Handle directory links (ending with /)
  if (targetPath.endsWith("/")) {
    targetPath = `${targetPath}README.md`;
  } else {
    // Get filename (last segment after /)
    const lastSlash = targetPath.lastIndexOf("/");
    const filename = lastSlash === -1 ? targetPath : targetPath.slice(lastSlash + 1);

    // Add .md if filename has no extension (no . or only leading .)
    if (!filename.includes(".") || filename.startsWith(".")) {
      targetPath = `${targetPath}.md`;
    }
  }

  // If it's an absolute path (starts with /), use as-is
  if (targetPath.startsWith("/")) {
    return normalizePath(targetPath);
  }

  // Resolve relative to current file's directory
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
