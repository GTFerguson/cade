/**
 * Shared primitive types for core/frontend.
 *
 * Keep this file deliberately small — only types that are genuinely
 * consumer-neutral belong here. Product-specific protocol shapes
 * (CADE's wire-message types, Padarax's engine frames, etc.) stay in
 * each product's own types file.
 */

/**
 * Lifecycle contract for UI components. Anything that owns DOM or
 * subscriptions implements this so it can be cleaned up deterministically.
 */
export interface Component {
  initialize(): void | Promise<void>;
  dispose(): void | Promise<void>;
}

/**
 * Generic event-handler signature. Preferred over inline
 * `(event: T) => void` because it reads as intent.
 */
export type EventHandler<T> = (data: T) => void;

/**
 * Generic typed event emitter. Useful as a structural type when wiring
 * pubsub across component boundaries.
 */
export interface EventEmitter<Events extends Record<string, unknown>> {
  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void;
  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void;
  emit<K extends keyof Events>(event: K, data: Events[K]): void;
}
