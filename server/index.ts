import { resolve } from 'node:path';
import express from 'express';

const port = Number(process.env.PORT ?? 3000);
const production = process.argv[1]?.endsWith('.js');
const app = express();

let stopVite: (() => Promise<void>) | undefined;
if (production) {
  app.use(express.static(resolve('dist/client')));
  app.get('/', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  stopVite = () => vite.close();
  app.use(vite.middlewares);
}
// shortcut: loopback-only until the public-demo limits and persistence milestone is complete.
const server = app.listen(port, '127.0.0.1', () => console.log(`MockMeister: http://localhost:${port}`));
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await stopVite?.();
  server.closeAllConnections();
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
