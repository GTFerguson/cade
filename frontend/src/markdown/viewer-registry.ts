export type ViewerFactory = (
  container: HTMLElement,
  data: Record<string, unknown>,
  navigateTo: (path: string) => void,
) => { dispose(): void };

interface ViewerEntry {
  pattern: RegExp;
  name: string;
  factory: ViewerFactory;
}

class ViewerRegistry {
  private entries: ViewerEntry[] = [];

  register(pattern: RegExp, name: string, factory: ViewerFactory): void {
    this.entries.push({ pattern, name, factory });
  }

  detect(path: string): ViewerFactory | null {
    for (const entry of this.entries) {
      if (entry.pattern.test(path)) return entry.factory;
    }
    return null;
  }
}

export const viewerRegistry = new ViewerRegistry();
