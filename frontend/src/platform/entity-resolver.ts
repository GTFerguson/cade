export interface EntityResolver {
  resolve(type: string, id: string): string | null;
}

let _resolver: EntityResolver | null = null;

export function setEntityResolver(r: EntityResolver): void {
  _resolver = r;
}

export function getEntityResolver(): EntityResolver | null {
  return _resolver;
}
