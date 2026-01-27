// =========================================================
// EVENT EMITTER — INTERNAL EVENT BUS
// =========================================================

import { EventType, SystemEvent } from '../types';

type EventHandler = (event: SystemEvent) => void;

/**
 * Simple typed event emitter for internal system events
 */
class EventEmitter {
  private handlers: Map<EventType, Set<EventHandler>> = new Map();
  private allHandlers: Set<EventHandler> = new Set();

  /**
   * Subscribe to a specific event type
   */
  on(type: EventType, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  /**
   * Subscribe to all events
   */
  onAll(handler: EventHandler): () => void {
    this.allHandlers.add(handler);
    return () => {
      this.allHandlers.delete(handler);
    };
  }

  /**
   * Emit an event
   */
  emit(type: EventType, data: unknown): void {
    const event: SystemEvent = {
      type,
      timestamp: Date.now(),
      data,
    };

    // Notify specific handlers
    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (error) {
          console.error(`Event handler error for ${type}:`, error);
        }
      }
    }

    // Notify all handlers
    for (const handler of this.allHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error(`Event handler error (all):`, error);
      }
    }
  }

  /**
   * Remove all handlers for a type
   */
  off(type: EventType): void {
    this.handlers.delete(type);
  }

  /**
   * Remove all handlers
   */
  clear(): void {
    this.handlers.clear();
    this.allHandlers.clear();
  }
}

// Export singleton instance
export const events = new EventEmitter();
