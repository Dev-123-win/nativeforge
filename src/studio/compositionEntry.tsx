/**
 * compositionEntry.tsx — Vite entry for composition.html (the iframe page)
 *
 * This module:
 * 1. Reads ?id= and ?props= from URL params
 * 2. Imports Root.tsx to trigger synchronous composition registration
 * 3. Finds the matching composition from the registry
 * 4. Wraps it in TimelineProvider and renders it
 *
 * The performance.now() override is already installed in composition.html
 * via an inline <script> that runs before this module loads.
 */
console.log('[CompositionEntry] Script starting...');
import React from 'react';
import ReactDOM from 'react-dom/client';
import { getAllCompositions } from '../core/registry';
import { TimelineProvider } from '../core/TimelineContext';

// Import Root.tsx — this triggers synchronous registerComposition() calls
import '../Root';

const params = new URLSearchParams(window.location.search);
const compositionId = params.get('id') ?? '';
const propsRaw = params.get('props');
let overrideProps: Record<string, unknown> | null = null;
try {
  if (propsRaw) overrideProps = JSON.parse(decodeURIComponent(propsRaw));
} catch {
  console.warn('[MotionFlow] Failed to parse ?props param');
}

// Root.tsx's import has registered all compositions synchronously.
// We can look up our composition immediately.
const allComps = getAllCompositions();
const config = allComps.find((c) => c.id === compositionId);

function CompositionApp() {
  if (!config) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100vw', height: '100vh',
        background: '#090b0f', color: '#ef4444',
        fontFamily: 'monospace', fontSize: '14px',
      }}>
        ⚠ Composition &quot;{compositionId}&quot; not found in registry.
      </div>
    );
  }

  const Component = config.component as React.ComponentType<Record<string, unknown>>;
  const props = { ...config.defaultProps, ...(overrideProps ?? {}) };

  return (
    <TimelineProvider config={config}>
      <Component {...props} />
    </TimelineProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <CompositionApp />
);
