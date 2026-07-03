import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
const ASSETS_DIR = path.join(ROOT, 'public/assets');
const MOTIONS_DIR = path.join(ROOT, 'src/motions');

interface TranscriptBeat {
  index: number;
  startFrame: number;
  endFrame: number;
  text: string;
  type: 'donut' | 'barchart' | 'linechart' | 'warning' | 'cta' | 'typography';
}

function parseTimestamp(timeStr: string, fps = 25): number {
  // Format: 00:00:02,280
  const parts = timeStr.trim().split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  
  const secParts = parts[2].split(',');
  const seconds = parseInt(secParts[0], 10);
  const ms = parseInt(secParts[1], 10);

  const totalMs = hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
  return Math.floor((totalMs * fps) / 1000);
}

function getBeatType(text: string): 'donut' | 'barchart' | 'linechart' | 'warning' | 'cta' | 'typography' {
  const lower = text.toLowerCase();
  
  if (lower.includes('subscribe') || lower.includes('call') || lower.includes('yours') || lower.includes('claim')) {
    return 'cta';
  }
  
  // Ratios (e.g. "7 in 10") or percentages
  if (/\b\d+\s+in\s+\d+\b/i.test(lower) || lower.includes('%') || lower.includes('percent') || lower.includes('percentage')) {
    return 'donut';
  }
  
  if (lower.includes('year') || lower.includes('2024') || lower.includes('2025') || lower.includes('timeline') || lower.includes('gap') || lower.includes('month after month')) {
    return 'linechart';
  }

  if (
    lower.includes('provision') || 
    lower.includes('offset') || 
    lower.includes('windfall') || 
    lower.includes('cut') || 
    lower.includes('warning') || 
    lower.includes('short') || 
    lower.includes('shortchange') || 
    lower.includes('outdated') || 
    lower.includes('missing') || 
    lower.includes('less') || 
    lower.includes("didn't")
  ) {
    return 'warning';
  }

  if (
    lower.includes('$') || 
    /\b\d+\b/.test(lower) || 
    lower.includes('million') || 
    lower.includes('millions') || 
    lower.includes('cent') || 
    lower.includes('money') || 
    lower.includes('check') || 
    lower.includes('dollar') || 
    lower.includes('dollars')
  ) {
    return 'barchart';
  }

  return 'typography';
}

function parseSrt(filePath: string, fps = 25): TranscriptBeat[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  // Normalize line endings
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const beats: TranscriptBeat[] = [];
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    
    // Parse block index
    const index = parseInt(line, 10);
    if (isNaN(index)) {
      i++;
      continue;
    }
    
    // Parse timestamp line (e.g. 00:00:00,000 --> 00:00:04,880)
    const timeLine = lines[i + 1]?.trim() || '';
    if (!timeLine.includes('-->')) {
      i++;
      continue;
    }
    
    const [startStr, endStr] = timeLine.split('-->');
    const startFrame = parseTimestamp(startStr, fps);
    const endFrame = parseTimestamp(endStr, fps);
    
    // Parse text (could be multiple lines)
    let text = '';
    let j = i + 2;
    while (j < lines.length && lines[j].trim() !== '') {
      text += (text ? ' ' : '') + lines[j].trim();
      j++;
    }
    
    const type = getBeatType(text);
    
    beats.push({
      index,
      startFrame,
      endFrame,
      text,
      type
    });
    
    i = j;
  }
  
  return beats;
}

export function generateEdits() {
  console.log('\n  🎬 Generating Automated Motion Design edits...\n');
  
  if (!fs.existsSync(ASSETS_DIR)) {
    console.error(`  ❌ public/assets/ directory does not exist: ${ASSETS_DIR}`);
    process.exit(1);
  }
  
  const files = fs.readdirSync(ASSETS_DIR);
  const transcripts = files.filter(f => f.endsWith('.txt')).sort();
  
  const registeredCompositions: { id: string; file: string; duration: number }[] = [];
  
  for (const tFile of transcripts) {
    const id = path.basename(tFile, '.txt'); // e.g. 01
    const mp4File = `${id}.mp4`;
    
    if (!files.includes(mp4File)) {
      console.warn(`  ⚠ Found transcript ${tFile} but no matching video ${mp4File}. Skipping.`);
      continue;
    }
    
    const txtPath = path.join(ASSETS_DIR, tFile);
    const beats = parseSrt(txtPath);
    
    if (beats.length === 0) {
      console.warn(`  ⚠ Empty transcript: ${tFile}. Skipping.`);
      continue;
    }
    
    // Duration is last frame plus small buffer
    const lastBeat = beats[beats.length - 1];
    const duration = lastBeat.endFrame + 15;
    
    // Generate component content
    const compName = `Edit${id}`;
    const componentCode = `import React from 'react';
import { Sequence, useCurrentFrame, useVideoConfig } from 'motionflow';
import { useSFX } from '../hooks/useSFX';
import {
  KineticTypography,
  DataBarChart,
  DataDonutChart,
  DataLineChart,
  GlitchWarningCard,
  CelebrationCtaOverlay
} from './Overlays';

export default function ${compName}() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const SFX = useSFX();
  const videoRef = React.useRef<HTMLVideoElement>(null);

  // Sync avatar video currentTime to current timeline frame (Fixes blank rendering and frozen playback in Studio)
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const targetTime = frame / fps;
    if (Math.abs(video.currentTime - targetTime) > 0.01) {
      video.currentTime = targetTime;
    }
  }, [frame, fps]);

  // Expose promise-based seek-to-frame for Playwright rendering (solves async seeking deadlocks)
  React.useEffect(() => {
    (window as any).__MOTIONFLOW_SEEK_TO_FRAME__ = (targetFrame: number, targetFps: number) => {
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
      delete (window as any).__MOTIONFLOW_SEEK_TO_FRAME__;
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#050508', overflow: 'hidden' }}>
      {/* Avatar Talking Video Layer */}
      <video 
        ref={videoRef}
        src="/assets/${mp4File}" 
        preload="auto"
        muted 
        playsInline
        style={{ 
          position: 'absolute', 
          width: '100%', 
          height: '100%', 
          objectFit: 'fill', // exact aspect ratio matching (no cropping)
          zIndex: 1 
        }} 
      />

      {/* Glassmorphic Ambient Border overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        boxShadow: 'inset 0 0 100px rgba(0,0,0,0.6)',
        border: '24px solid rgba(14, 17, 23, 0.4)',
        pointerEvents: 'none',
        zIndex: 2
      }} />

      {/* Motion Design Overlays (timed using Sequence) */}
      {/* Visuals start 3 frames before audio cues for anticipating feels */}
      <Sequence from={0} durationInFrames={${duration}}>
        <div style={{ display: 'none' }} />
      </Sequence>

      ${beats.map(beat => {
        const componentMap = {
          donut: 'DataDonutChart',
          barchart: 'DataBarChart',
          linechart: 'DataLineChart',
          warning: 'GlitchWarningCard',
          cta: 'CelebrationCtaOverlay',
          typography: 'KineticTypography'
        };
        const comp = componentMap[beat.type];
        // Visual starts 3 frames early for Apple WWDC-style anticipation feel (stretching into Sequence boundary)
        const fromFrame = Math.max(0, beat.startFrame - 3);
        const durationFrames = (beat.endFrame - beat.startFrame) + 6;
        
        return `<Sequence from={${fromFrame}} durationInFrames={${durationFrames}}>
        <${comp} frame={frame} fps={fps} text={${JSON.stringify(beat.text)}} SFX={SFX} />
      </Sequence>`;
      }).join('\n\n      ')}
    </div>
  );
}
`;
    
    const outFilePath = path.join(MOTIONS_DIR, `${compName}.tsx`);
    fs.writeFileSync(outFilePath, componentCode, 'utf-8');
    console.log(`  ✓ Generated edit component: src/motions/${compName}.tsx (${beats.length} beats mapped)`);
    
    registeredCompositions.push({
      id,
      file: compName,
      duration
    });
  }
  
  // Now write / update Root.tsx
  const rootCode = `import React from 'react';
import { Composition } from 'motionflow';
import Intro from './motions/Intro';
${registeredCompositions.map(c => `import Edit${c.id} from './motions/Edit${c.id}';`).join('\n')}

export default function Root() {
  return (
    <>
      <Composition
        id="Intro"
        component={Intro}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: 'Hello World', subtitle: 'A MotionFlow Production', accentColor: '#6366f1' }}
      />
      <Composition
        id="Intro-Purple"
        component={Intro}
        durationInFrames={90}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{ title: 'MotionFlow', subtitle: 'Framer-Native Video Engine', accentColor: '#a78bfa' }}
      />
      
      {/* Automatically Generated AI Video Edits */}
      ${registeredCompositions.map(c => `<Composition
        id="Edit-${c.id}"
        component={Edit${c.id}}
        durationInFrames={${c.duration}}
        fps={25}
        width={1920}
        height={1080}
        defaultProps={{}}
      />`).join('\n      ')}
    </>
  );
}

// Synchronously evaluate the tree of Compositions on module load so that
// they are registered globally in memory instantly when this module is imported.
console.log('[Root] Starting module evaluation and composition registration...');
const element = React.createElement(Root);
const traverse = (node: any) => {
  if (!node) return;
  if (typeof node !== 'object') return;

  if (node.type === Root) {
    traverse(node.type());
  } else if (node.type && (node.type === Composition || node.type.name === 'Composition')) {
    try {
      console.log(\`[Root] Registering: \${node.props.id}\`);
      node.type(node.props);
    } catch (e) {
      console.error('[Root] Evaluation error on child:', e);
    }
  }

  if (node.props && node.props.children) {
    React.Children.forEach(node.props.children, (child) => {
      traverse(child);
    });
  } else if (Array.isArray(node)) {
    node.forEach((child) => traverse(child));
  }
};
traverse(element);
console.log('[Root] Registration complete!');
`;
  
  fs.writeFileSync(path.join(ROOT, 'src/Root.tsx'), rootCode, 'utf-8');
  console.log(`  ✓ Updated src/Root.tsx registry with ${registeredCompositions.length} composition edits.`);
  console.log('\n  🎉 Generation complete! You can open Studio to preview the edits.');
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateEdits();
}
