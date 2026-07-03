import type { CompositionConfig } from './Composition';

// Global registry of all registered compositions
const compositions = new Map<string, CompositionConfig>();

export function registerComposition(config: CompositionConfig): void {
  compositions.set(config.id, config);

  // Expose to window so Playwright and iframe bridge can access it
  if (typeof window !== 'undefined') {
    (window as any).__MOTIONFLOW_REGISTRY__ = {
      getComposition,
      getAllCompositions,
      compositions: Object.fromEntries(compositions),
    };
  }
}

export function unregisterComposition(id: string): void {
  compositions.delete(id);
}

export function getComposition(id: string): CompositionConfig | undefined {
  return compositions.get(id);
}

export function getAllCompositions(): CompositionConfig[] {
  return Array.from(compositions.values());
}
