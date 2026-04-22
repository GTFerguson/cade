/**
 * Component registry — maps type strings from config to component classes.
 *
 * Adding a new component type: write the class, add one line to
 * createDefaultRegistry().
 */

import {
  BasketComponent,
  CardsPaged,
  CardsComponent,
  ClaimsComponent,
  ChecklistComponent,
  GraphComponent,
  KanbanComponent,
  KeyValueComponent,
  MarkdownPanelComponent,
  ModelStatsComponent,
  SplitMarkdownComponent,
  NpcDetailComponent,
  TableComponent,
  TimelineComponent,
  WorldDetailComponent,
} from "./components";
import type { DashboardComponent } from "./types";

type ComponentConstructor = new () => DashboardComponent;

export class ComponentRegistry {
  private components = new Map<string, ComponentConstructor>();

  register(type: string, ctor: ComponentConstructor): void {
    this.components.set(type, ctor);
  }

  create(type: string): DashboardComponent {
    const Ctor = this.components.get(type);
    if (!Ctor) {
      throw new Error(`Unknown dashboard component type: "${type}"`);
    }
    return new Ctor();
  }

  has(type: string): boolean {
    return this.components.has(type);
  }
}

export function createDefaultRegistry(): ComponentRegistry {
  const registry = new ComponentRegistry();
  registry.register("basket", BasketComponent);
  registry.register("claims", ClaimsComponent);
  registry.register("cards", CardsComponent);
  registry.register("cards_paged", CardsPaged);
  registry.register("graph", GraphComponent);
  registry.register("checklist", ChecklistComponent);
  registry.register("kanban", KanbanComponent);
  registry.register("key_value", KeyValueComponent);
  registry.register("markdown", MarkdownPanelComponent);
  registry.register("model_stats", ModelStatsComponent);
  registry.register("split_markdown", SplitMarkdownComponent);
  registry.register("npc_detail", NpcDetailComponent);
  registry.register("table", TableComponent);
  registry.register("timeline", TimelineComponent);
  registry.register("world_detail", WorldDetailComponent);
  return registry;
}
