import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import express from 'express';
import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const certFile = process.env.HTTPS_CERT_FILE;
const keyFile = process.env.HTTPS_KEY_FILE;
if (Boolean(certFile) !== Boolean(keyFile)) throw new Error('Set both HTTPS_CERT_FILE and HTTPS_KEY_FILE to enable HTTPS.');
const publicOrigin = process.env.PUBLIC_ORIGIN ?? `${certFile ? 'https' : 'http'}://localhost:${port}`;
const production = process.argv[1]?.endsWith('.js');
const { app, close } = createApp({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: process.env.REALTIME_MODEL ?? 'gpt-realtime-2.1-mini',
  publicOrigin,
  demoEnabled: process.env.DEMO_ENABLED === 'true',
});
const server = certFile && keyFile
  ? createHttpsServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, app)
  : createHttpServer(app);

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
server.listen(port, host, () => console.log(`MockMeister: ${publicOrigin}`));
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
