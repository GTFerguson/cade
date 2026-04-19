/**
 * Shared utilities for @type:id cross-reference syntax used in knowledge files.
 * Mirrors the REF_RE pattern from tools/validate_knowledge.py.
 */

export const REF_RE = /@([a-z]+):([\w-]+)(\+pl)?/g;

export interface KnowledgeRef {
  type: string;
  id: string;
  plural: boolean;
}

export function parseRef(raw: string): KnowledgeRef | null {
  const m = /^@([a-z]+):([\w-]+)(\+pl)?$/.exec(raw.trim());
  if (!m) return null;
  return { type: m[1], id: m[2], plural: m[3] != null };
}

/**
 * Render a prose string as a DocumentFragment, replacing @type:id refs with
 * styled <span> badges. Caller can attach click handlers to .hv-ref elements.
 */
export function renderProseWithRefs(prose: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let last = 0;
  const re = new RegExp(REF_RE.source, "g");
  let m: RegExpExecArray | null;

  while ((m = re.exec(prose)) !== null) {
    if (m.index > last) {
      frag.appendChild(document.createTextNode(prose.slice(last, m.index)));
    }
    const badge = document.createElement("span");
    badge.className = "hv-ref";
    badge.dataset.refType = m[1];
    badge.dataset.refId = m[2];
    badge.textContent = `@${m[1]}:${m[2]}`;
    frag.appendChild(badge);
    last = m.index + m[0].length;
  }

  if (last < prose.length) {
    frag.appendChild(document.createTextNode(prose.slice(last)));
  }

  return frag;
}
