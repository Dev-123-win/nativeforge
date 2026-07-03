import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { CompositionConfig } from './Composition';

export interface TimelineState {
  frame: number;
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
  playing: boolean;
}

const defaultState: TimelineState = {
  frame: 0,
  fps: 30,
  durationInFrames: 150,
  width: 1920,
  height: 1080,
  playing: false,
};

export const TimelineContext = createContext<TimelineState>(defaultState);

interface TimelineProviderProps {
  children: React.ReactNode;
  config: Omit<CompositionConfig, 'component' | 'defaultProps' | 'id'>;
}

/**
 * Wraps a composition and provides frame/fps/dimensions/playing via context.
 *
 * Receives SET_FRAME postMessages from the parent Studio window.
 * Sets __motionFlowOverride on performance BEFORE calling setFrame()
 * so Framer Motion reads the virtual timestamp atomically on the next
 * rAF tick — ensuring instant snap rather than tweening.
 */
export function TimelineProvider({ children, config }: TimelineProviderProps) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'SET_FRAME') {
        const targetFrame = e.data.frame as number;
        const isPlaying = e.data.playing as boolean ?? false;
        const fps = configRef.current.fps;
        const virtualMs = (targetFrame / fps) * 1000;

        // Set the override BEFORE setState so Framer Motion reads the
        // correct virtual timestamp on the very next render cycle.
        (performance as any).__motionFlowOverride = virtualMs;
        setFrame(targetFrame);
        setPlaying(isPlaying);
      }
    };

    window.addEventListener('message', handler);

    // Expose for Playwright's page.evaluate() in render mode
    (window as any).__setFrame = (f: number) => {
      const fps = configRef.current.fps;
      const virtualMs = (f / fps) * 1000;
      (performance as any).__motionFlowOverride = virtualMs;
      setFrame(f);
      setPlaying(false);
    };

    // Signal to Playwright that the composition is mounted and ready (waiting for all videos to be ready)
    const checkVideosReady = () => {
      const videos = Array.from(document.querySelectorAll('video'));
      const allReady = videos.every((v) => v.readyState >= 1);
      if (allReady) {
        (window as any).__MOTIONFLOW_READY__ = true;
      } else {
        const pendingVideos = videos.filter((v) => v.readyState < 1);
        let loadedCount = 0;
        
        pendingVideos.forEach((v) => {
          v.addEventListener('loadedmetadata', () => {
            loadedCount++;
            if (loadedCount >= pendingVideos.length) {
              (window as any).__MOTIONFLOW_READY__ = true;
            }
          }, { once: true });
        });
      }
    };

    requestAnimationFrame(() => {
      checkVideosReady();
    });

    // Notify parent studio that iframe is loaded and ready to sync frame
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'IFRAME_READY' }, '*');
    }

    return () => {
      window.removeEventListener('message', handler);
    };
  }, []);

  const value: TimelineState = {
    frame,
    fps: config.fps,
    durationInFrames: config.durationInFrames,
    width: config.width,
    height: config.height,
    playing,
  };

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  );
}

/** Returns the current frame number inside a composition. */
export function useCurrentFrame(): number {
  return useContext(TimelineContext).frame;
}

/** Returns fps, width, height, durationInFrames, playing for the current composition. */
export function useVideoConfig(): Omit<TimelineState, 'frame'> {
  const { frame: _frame, ...rest } = useContext(TimelineContext);
  return rest;
}

/**
 * Custom hook to synchronize a video element with the TimelineContext.
 * Handles Playwright seeks, active playback play/pause state, and frame alignment.
 */
export function useVideoSync(videoRef: React.RefObject<HTMLVideoElement | null>): void {
  const { frame, fps, playing } = useContext(TimelineContext);

  // Expose promise-based seek-to-frame for Playwright rendering
  useEffect(() => {
    const win = typeof window !== 'undefined' ? (window as any) : null;
    if (!win) return;

    win.__MOTIONFLOW_SEEK_TO_FRAME__ = (targetFrame: number, targetFps: number) => {
      const video = videoRef.current;
      if (!video) return Promise.resolve();

      const targetTime = targetFrame / targetFps;
      if (Math.abs(video.currentTime - targetTime) <= 0.01) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = targetTime;
      });
    };

    return () => {
      if (win.__MOTIONFLOW_SEEK_TO_FRAME__) {
        delete win.__MOTIONFLOW_SEEK_TO_FRAME__;
      }
    };
  }, [videoRef]);

  // Sync play/pause state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (playing) {
      video.play().catch((err) => {
        console.warn('[MotionFlow] Playback blocked by browser autoplay policy:', err);
      });
    } else {
      video.pause();
    }
  }, [playing, videoRef]);

  // Sync video currentTime to frame
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const targetTime = frame / fps;

    if (playing) {
      // During active playback, only force-seek if drift is significant (e.g. > 0.15s)
      if (Math.abs(video.currentTime - targetTime) > 0.15) {
        video.currentTime = targetTime;
      }
    } else {
      // When paused/scrubbing, seek precisely
      if (Math.abs(video.currentTime - targetTime) > 0.01) {
        video.currentTime = targetTime;
      }
    }
  }, [frame, fps, playing, videoRef]);
}

