import { resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import express from 'express';
import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 3000);
const publicOrigin = process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;
const production = process.argv[1]?.endsWith('.js');
const { app, close } = createApp({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: process.env.REALTIME_MODEL ?? 'gpt-realtime-2.1-mini',
  publicOrigin,
  demoEnabled: process.env.DEMO_ENABLED === 'true',
});
const server = createHttpServer(app);

let stopVite: (() => Promise<void>) | undefined;
if (production) {
  app.use(express.static(resolve('dist/client')));
  app.get('/', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, ws: { server } }, appType: 'spa' });
  stopVite = () => vite.close();
  app.use(vite.middlewares);
}
server.listen(port, '127.0.0.1', () => console.log(`MockMeister: ${publicOrigin}`));
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await close();
  await stopVite?.();
  server.closeAllConnections();
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
