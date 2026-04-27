/**
 * Padarax-specific path helpers and entity resolver for the @type:id cross-
 * reference system. The generic parse + render utilities live in
 * platform/refs.ts — this file owns the bits that depend on Padarax's
 * content layout (knowledge/, npcs/, generated/enriched/).
 */

import type { EntityResolver } from "../platform/entity-resolver";

/**
 * Given any path to a knowledge file, return the sibling generated/enriched/
 * directory. Works regardless of where the knowledge tree is rooted.
 */
export function enrichedDirForPath(path: string): string {
  const m = path.match(/^(.*\/knowledge\/)/);
  return m ? `${m[1]}generated/enriched` : "content/worlds/padarax/knowledge/generated/enriched";
}

/**
 * Source content files lack _ref_status metadata; redirect to the enriched
 * version which carries it. Handles both knowledge entities and NPC files.
 * Path-agnostic — matches any knowledge/ or npcs/ segment outside generated/.
 */
export function preferEnrichedPath(path: string): string {
  const knowledgeM = path.match(/^(.*\/knowledge\/)(?!generated\/).*\/([^/]+\.json)$/);
  if (knowledgeM) return `${knowledgeM[1]}generated/enriched/${knowledgeM[2]}`;

  const npcM = path.match(/^(.*\/npcs\/)(?!generated\/)([^/]+\.json)$/);
  if (npcM) return `${npcM[1]}generated/enriched/${npcM[2]}`;

  return path;
}

/**
 * Resolves @type:id refs to file paths for Padarax content types.
 * Register via setEntityResolver() at app startup.
 */
export class KnowledgeEntityResolver implements EntityResolver {
  private knowledgeBase: string;

  constructor(knowledgeBase = "content/worlds/padarax/knowledge/generated/enriched") {
    this.knowledgeBase = knowledgeBase;
  }

  resolve(type: string, id: string): string | null {
    if (type === "npc") return `content/worlds/padarax/npcs/generated/enriched/${id}.json`;
    if (type === "location" || type === "room") return null; // resolved via world viewer
    return `${this.knowledgeBase}/${id}.json`;
  }
}
