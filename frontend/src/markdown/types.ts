import type { FileContentEncoding } from "../types";

import type { EventHandler } from "../types";

export interface MarkdownEvents {
  "link-click": string;
  "edit-in-neovim": string;
}

export interface ViewState {
  path: string | null;
  content: string;
  fileType: string;
  encoding: FileContentEncoding;
  size: number;
  mime: string | undefined;
  scrollTop: number;
}

export interface Frontmatter {
  [key: string]: unknown;
}

export interface ParsedContent {
  frontmatter: Frontmatter | null;
  content: string;
}

export type MarkdownEventHandlers = Map<
  keyof MarkdownEvents,
  Set<EventHandler<MarkdownEvents[keyof MarkdownEvents]>>
>;
