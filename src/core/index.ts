// Public API for MotionFlow compositions
export { Composition } from './Composition';
export type { CompositionConfig } from './Composition';
export { TimelineProvider, useCurrentFrame, useVideoConfig, useVideoSync } from './TimelineContext';
export { getAllCompositions, getComposition } from './registry';
export { Sequence } from './Sequence';
export type { SequenceProps } from './Sequence';
