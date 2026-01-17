/**
 * Type declarations for mertex.md
 */

declare module "mertex.md" {
  export interface MertexMDOptions {
    breaks?: boolean;
    gfm?: boolean;
    headerIds?: boolean;
    katex?: boolean;
    mermaid?: boolean;
    highlight?: boolean;
    sanitize?: boolean;
    protectMath?: boolean;
    renderOnRestore?: boolean;
    debug?: boolean;
  }

  export interface RenderResult {
    html: string;
    mermaidMap: Map<string, string>;
    katexMap: Map<string, string>;
  }

  export class MertexMD {
    constructor(options?: MertexMDOptions);

    /**
     * Render markdown to HTML string
     */
    render(markdown: string, options?: MertexMDOptions): string;

    /**
     * Render markdown with full result including maps
     */
    renderFull(markdown: string, options?: MertexMDOptions): RenderResult;

    /**
     * Render markdown into a DOM element
     */
    renderInElement(
      element: HTMLElement,
      markdown?: string,
      options?: MertexMDOptions
    ): Promise<void>;

    /**
     * Auto-render all matching elements
     */
    autoRender(selector: string, options?: MertexMDOptions): Promise<void>;

    /**
     * Initialize auto-rendering on DOMContentLoaded
     */
    init(): void;
  }

  export default MertexMD;
}
