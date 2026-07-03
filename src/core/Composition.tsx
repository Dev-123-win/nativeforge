import type React from 'react';
import { registerComposition } from './registry';

export interface CompositionConfig<T = any> {
  id: string;
  component: React.ComponentType<T>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps: T;
}

// Module-level set to prevent double-registration under React 18 Strict Mode
// (which double-invokes render functions in development)
const registeredIds = new Set<string>();

/**
 * Declares a composition. Renders nothing — purely declarative metadata.
 *
 * Registration is SYNCHRONOUS (at render time, not in useEffect) so that
 * window.__MOTIONFLOW_REGISTRY__ is populated before Playwright's
 * waitForFunction check fires. This avoids race conditions where Playwright
 * looks for compositions before React has finished mounting.
 */
export function Composition<T>(props: CompositionConfig<T>): null {
  if (!registeredIds.has(props.id)) {
    registeredIds.add(props.id);
    registerComposition(props);
  }
  return null;
}
