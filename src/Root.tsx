import React from 'react';
import { Composition } from './core';
import { registerComposition } from './core/registry';
import Edit01 from './motions/Edit01';
import Edit02 from './motions/Edit02';
import Edit03 from './motions/Edit03';
import Edit04 from './motions/Edit04';
import Edit05 from './motions/Edit05';
import Edit06 from './motions/Edit06';
import Edit07 from './motions/Edit07';
import Edit08 from './motions/Edit08';
import Edit09 from './motions/Edit09';

// ─── Composition definitions with exact video frames at 25fps ─────────────────
const COMPOSITIONS = [
  { id: 'edit-01', component: Edit01, durationInFrames: 1705, fps: 25, width: 1920, height: 1080, defaultProps: {} },
  { id: 'edit-02', component: Edit02, durationInFrames: 2284, fps: 25, width: 1920, height: 1080, defaultProps: {} },
  { id: 'edit-03', component: Edit03, durationInFrames: 1793, fps: 25, width: 1920, height: 1080, defaultProps: {} },
  { id: 'edit-04', component: Edit04, durationInFrames: 1821, fps: 25, width: 1920, height: 1080, defaultProps: {} },
  { id: 'edit-05', component: Edit05, durationInFrames: 1615, fps: 25, width: 1920, height: 1080, defaultProps: {} },
  { id: 'edit-06', component: Edit06, durationInFrames: 2078, fps: 25, width: 1920, height: 1080, defaultProps: {} },
  { id: 'edit-07', component: Edit07, durationInFrames: 1912, fps: 25, width: 1920, height: 1080, defaultProps: {} },
  { id: 'edit-08', component: Edit08, durationInFrames: 2231, fps: 25, width: 1920, height: 1080, defaultProps: {} },
  { id: 'edit-09', component: Edit09, durationInFrames: 556,  fps: 25, width: 1920, height: 1080, defaultProps: {} },
] as const;

// ─── Register synchronously at module-eval time ────────────────────────────────
for (const cfg of COMPOSITIONS) {
  registerComposition(cfg as any);
}

console.log(`[Root] Registered ${COMPOSITIONS.length} compositions with exact 25fps settings.`);

// ─── JSX Root (used by compositionEntry.tsx iframe path) ──────────────────────
export default function Root() {
  return (
    <>
      {COMPOSITIONS.map((cfg) => (
        <Composition key={cfg.id} {...(cfg as any)} />
      ))}
    </>
  );
}
