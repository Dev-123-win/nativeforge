import React, { useRef, useEffect, useState } from 'react';

interface ViewportProps {
  compositionId: string;
  frame: number;
  playing: boolean;
  width: number;
  height: number;
}

/**
 * Renders the composition inside a sandboxed iframe.
 * The parent window (studio) sends frame updates via postMessage.
 * The iframe's performance.now() is overridden — parent window is NOT affected.
 */
export function Viewport({ compositionId, frame, playing, width, height }: ViewportProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Zoom-to-fit: recompute scale when wrapper size changes
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const compute = () => {
      const rect = wrapper.getBoundingClientRect();
      const padding = 48;
      const scaleX = (rect.width - padding * 2) / width;
      const scaleY = (rect.height - padding * 2) / height;
      setScale(Math.min(scaleX, scaleY, 1));
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [width, height]);

  // Send frame update to iframe via postMessage
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: 'SET_FRAME', frame, playing }, '*');
  }, [frame, playing]);

  // Listen for handshake from iframe when it is ready, and immediately sync current frame
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'IFRAME_READY') {
        const iframe = iframeRef.current;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'SET_FRAME', frame, playing }, '*');
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [frame, playing]);

  const src = `/composition.html?id=${encodeURIComponent(compositionId)}`;

  return (
    <div className="viewport-wrapper" ref={wrapperRef}>
      <div
        className="viewport-frame"
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        <iframe
          ref={iframeRef}
          src={src}
          width={width}
          height={height}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          title={`Composition: ${compositionId}`}
        />
      </div>
      <div className="viewport-label">
        {width} × {height}
      </div>
    </div>
  );
}
