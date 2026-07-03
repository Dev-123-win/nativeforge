import React, { useContext } from 'react';
import { TimelineContext, type TimelineState } from './TimelineContext';

export interface SequenceProps {
  from: number;
  durationInFrames: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Sequence shifts the current frame of its children so that frame 0
 * aligns with the `from` property. It only renders its children when the
 * current active frame is within [from, from + durationInFrames - 1].
 */
export function Sequence({ from, durationInFrames, children, style }: SequenceProps) {
  const parentContext = useContext(TimelineContext);
  const localFrame = parentContext.frame - from;

  // Only render children if the current frame is within the active range
  if (parentContext.frame < from || parentContext.frame >= from + durationInFrames) {
    return null;
  }

  // Create local context with shifted frame
  const localContext: TimelineState = {
    ...parentContext,
    frame: localFrame,
    durationInFrames,
  };

  return (
    <TimelineContext.Provider value={localContext}>
      <div
        className="motionflow-sequence"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          width: '100%',
          height: '100%',
          ...style,
        }}
      >
        {children}
      </div>
    </TimelineContext.Provider>
  );
}
