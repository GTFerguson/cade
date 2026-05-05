export type MemoryEntryType = "decision" | "attempt" | "note";
export type SymbolKind = "class" | "function" | "module";
export type EvidenceKind = "doc" | "code" | "external";

export interface MemoryEvidence {
  kind: EvidenceKind;
  uri: string;
  label?: string;
}

export interface RejectedAlternative {
  label: string;
  reason: string;
}

export interface MemoryEntry {
  uuid: string;
  type: MemoryEntryType;
  title: string;
  body?: string;
  date: string;
  authored_by?: string;
  session?: string;
  tags?: string[];
  evidence?: MemoryEvidence[];
  rejected_alternatives?: RejectedAlternative[];
  supersedes?: string;
  superseded_by?: string;
  archived?: boolean;
}

export interface MemorySymbol {
  uuid: string;
  name: string;
  fqn: string;
  kind: SymbolKind;
  file?: string;
  line_start?: number;
  line_end?: number;
  memories: MemoryEntry[];
  children?: MemorySymbol[];
  tombstoned?: boolean;
  deleted_at?: string;
  previous_name?: string;
}

export interface RetargetCandidate {
  uuid: string;
  name: string;
  fqn: string;
  file: string;
  line: number;
  confidence: number;
}

export interface OrphanMemory extends MemoryEntry {
  applies_to_name: string;
  candidates: RetargetCandidate[];
}

export interface GraphModule {
  name: string;
  path: string;
  children: (GraphModule | MemorySymbol)[];
}

export interface NkrdnGraphMessage {
  type: "nkrdn-graph";
  modules: GraphModule[];
  tombstoned: MemorySymbol[];
  orphans: OrphanMemory[];
  stats: { symbols: number; memories: number; orphans: number };
}

export interface NkrdnSelectMessage {
  type: "nkrdn-select";
  symbol: MemorySymbol | null;
}

export function isGraphModule(node: GraphModule | MemorySymbol): node is GraphModule {
  return "children" in node && !("uuid" in node);
}
