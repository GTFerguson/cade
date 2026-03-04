/**
 * Type declarations for mertex.md
 */

declare module "mertex.md" {
  export interface SelfCorrectOptions {
    fix: (code: string, format: "mermaid" | "katex", error: string) => Promise<string>;
    maxRetries?: number;
  }

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
    selfCorrect?: SelfCorrectOptions;
  }

  export interface RenderResult {
    html: string;
    mermaidMap: Map<string, string>;
    katexMap: Map<string, string>;
  }

  export interface SelfCorrectResult {
    success: boolean;
    result?: any;
    code?: string;
  }

  export interface StreamRenderer {
    appendContent(chunk: string): Promise<boolean>;
    finalize(): Promise<void>;
    getContent(): string;
  }

  export class MertexMD {
    constructor(options?: MertexMDOptions);

    render(markdown: string, options?: MertexMDOptions): Promise<string>;
    renderFull(markdown: string, options?: MertexMDOptions): Promise<RenderResult>;
    renderInElement(
      element: HTMLElement,
      markdown?: string,
      options?: MertexMDOptions
    ): Promise<void>;
    autoRender(selector: string, options?: MertexMDOptions): Promise<void>;
    init(): void;
    createStreamRenderer(element: HTMLElement): StreamRenderer;
  }

  export function selfCorrectRender(
    code: string,
    format: "mermaid" | "katex",
    error: string,
    renderFn: (code: string) => Promise<any>,
    options: SelfCorrectOptions
  ): Promise<SelfCorrectResult>;

  export default MertexMD;
}
