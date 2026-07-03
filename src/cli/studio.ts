import { createServer } from 'vite';
import open from 'open';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');

export async function startStudio(port = 3100): Promise<void> {
  console.log('\n  ⚡ MotionFlow Studio\n');

  const vite = await createServer({
    root: ROOT,
    server: {
      port,
      strictPort: false, // auto-increment port if busy
    },
    logLevel: 'warn',
  });

  await vite.listen();

  const actualPort = vite.config.server.port ?? port;
  const url = `http://localhost:${actualPort}`;

  console.log(`  Studio running at: \x1b[36m${url}\x1b[0m`);
  console.log(`  Press \x1b[1mCtrl+C\x1b[0m to stop.\n`);

  await open(url);

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\n  Stopping studio...');
    await vite.close();
    process.exit(0);
  });
}
