/**
 * Entity helpers shared by the components that change rows.
 *
 * A source's `entity:` block names the field that identifies a row and the
 * status moves it allows. Components read both through here so a source
 * whose id field is not `id` patches the right row everywhere.
 */

import type { DashboardConfig, EntityConfig, PanelConfig } from "./types";

const DEFAULT_ID_FIELD = "id";

export function entityConfigFor(
  panel: PanelConfig,
  config: DashboardConfig,
): EntityConfig | undefined {
  if (!panel.source) return undefined;
  return config.data_sources[panel.source]?.entity ?? undefined;
}

/** The value a patch for `item` must carry as its `entityId`. */
export function entityIdOf(
  item: Record<string, unknown>,
  panel: PanelConfig,
  config: DashboardConfig,
): string {
  const field = entityConfigFor(panel, config)?.id_field || DEFAULT_ID_FIELD;
  const value = item[field];
  return value == null ? "" : String(value);
}

/**
 * Whether a row may move from one status to another.
 *
 * With no transitions declared, every move is allowed. Once any are
 * declared, a status without an entry is final: nothing may leave it.
 */
export function canTransition(
  entity: EntityConfig | undefined,
  from: string,
  to: string,
): boolean {
  const transitions = entity?.transitions ?? {};
  if (Object.keys(transitions).length === 0) return true;
  return (transitions[from] ?? []).includes(to);
}
