# Creating Compositions

MotionFlow compositions are standard React components that use Framer Motion for animation. They read timeline properties via React hooks provided by the core engine.

---

## 🔑 Timeline Hooks

To sync your animations with the hijacked clock, use these two core hooks from `motionflow`:

### 1. `useCurrentFrame()`
Returns the active frame number (starting at `0`). This frame updates whenever the timeline is playing in the Studio, when the user scrubs, or when the Playwright renderer captures frames.

### 2. `useVideoConfig()`
Returns the metadata configured for the composition:
- `fps`: Frames per second (e.g., `30` or `60`).
- `durationInFrames`: Total duration of the animation.
- `width`: Video width in pixels.
- `height`: Video height in pixels.

---

## 📝 Declaring Compositions in Root.tsx

Compositions must be registered in the central `src/Root.tsx` file using the `<Composition>` component. 

> [!IMPORTANT]
> Registration is **synchronous** and executed at module evaluation time. This guarantees that the registry is fully populated before any browser automation or iframe bridge query checks it.

```tsx
import React from 'react';
import { Composition } from 'motionflow';
import Intro from './motions/Intro';

export default function Root() {
  return (
    <>
      <Composition
        id="Intro"
        component={Intro}
        durationInFrames={150} // 5 seconds at 30fps
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          title: 'Hello World',
          accentColor: '#6366f1'
        }}
      />
    </>
  );
}
```

---

## 🎨 Complete Composition Example

Here is a standard, working implementation of a composition component (`src/motions/Intro.tsx`) illustrating timing hooks, custom props, and Framer Motion integration:

```tsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurrentFrame, useVideoConfig } from 'motionflow';

interface IntroProps {
  title: string;
  subtitle?: string;
  accentColor?: string;
}

export default function Intro({
  title,
  subtitle = 'Powered by MotionFlow',
  accentColor = '#6366f1',
}: IntroProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Compute conditions based on the current frame
  const showSubtitle = frame > fps * 1; // Show after 1 second
  
  // Create a progressive fade-out in the last 15 frames
  const opacity = frame > durationInFrames - 15
    ? (durationInFrames - frame) / 15
    : 1;

  return (
    <div
      style={{
        background: '#050508',
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        position: 'relative',
        opacity,
      }}
    >
      {/* Background Glow */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 80% 60% at 50% 50%, ${accentColor}22 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Spring Animated Title */}
      <AnimatePresence mode="wait">
        <motion.h1
          key={title}
          initial={{ y: 80, opacity: 0, filter: 'blur(12px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: -80, opacity: 0, filter: 'blur(12px)' }}
          transition={{ type: 'spring', damping: 14, stiffness: 120 }}
          style={{
            color: 'white',
            fontSize: '5rem',
            fontWeight: 700,
            marginBottom: '20px',
          }}
        >
          {title}
        </motion.h1>
      </AnimatePresence>

      {/* Subtitle Reveal */}
      <AnimatePresence>
        {showSubtitle && (
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 20, stiffness: 150 }}
            style={{
              color: 'rgba(255, 255, 255, 0.45)',
              fontSize: '1.2rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
            }}
          >
            {subtitle}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
```
