import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import OpenAI from 'openai';
import { createTurnController } from '../shared/voice.ts';
import { challenge } from './challenge.ts';
import { connectRealtime } from './realtime.ts';
import type { VoiceCall } from './realtime.ts';

type Config = { apiKey: string; model: string; publicOrigin: string; demoEnabled: boolean };
type Session = {
  id: string;
  handleHash: Buffer;
  status: 'starting' | 'active' | 'ending' | 'ended';
  createdAt: number;
  deadlineAt: number | null;
  lastHeartbeat: number;
  attempted: boolean;
  abort: AbortController;
  controller: ReturnType<typeof createTurnController>;
  call?: VoiceCall;
  closing?: Promise<void>;
  error?: string;
};

const hash = (value: string) => createHash('sha256').update(value).digest();
const empty = z.object({}).strict();
const offer = z.object({ offerSdp: z.string().max(65_536).startsWith('v=0').refine(sdp => sdp.includes('m=audio')) }).strict();
const heartbeat = z.object({ voiceConnected: z.boolean() }).strict();

export function createApp(config: Config, connect = connectRealtime) {
  const app = express();
  const sessions = new Map<string, Session>();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if ((req.method !== 'GET' || req.headers.origin) && req.headers.origin !== config.publicOrigin) {
      res.status(403).json({ error: { code: 'origin', message: 'Open MockMeister from its configured address.', retryable: false } });
      return;
    }
    next();
  });
  app.use('/api', express.json({ limit: '70kb' }));

  function snapshot(session: Session) {
    return { status: session.status, deadlineAt: session.deadlineAt,
      turns: [...session.controller.log.turns.values()], error: session.error };
  }

  function find(req: Request, res: Response) {
    const session = sessions.get(String(req.params.id));
    const handle = req.get('X-Interview-Session');
    if (!session || !handle || handle.length > 128 || !timingSafeEqual(hash(handle), session.handleHash)) {
      res.status(404).json({ error: { code: 'session', message: 'Interview not found.', retryable: false } });
      return;
    }
    return session;
  }

  function end(session: Session, message?: string) {
    if (session.closing) return session.closing;
    session.status = 'ending';
    session.error ??= message;
    try { session.controller.stop(); } catch { /* The REST hangup still runs if control has disconnected. */ }
    session.abort.abort();
    session.closing = (async () => {
      try {
        await session.call?.close();
      } catch {
        session.error = 'Local audio stopped; provider termination could not be confirmed.';
        console.error(JSON.stringify({ sessionId: session.id, event: 'hangup.unconfirmed' }));
      } finally {
        session.status = 'ended';
      }
    })();
    return session.closing;
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, configured: Boolean(config.apiKey) }));
  app.post('/api/sessions', (req, res) => {
    empty.parse(req.body);
    if (!config.demoEnabled || !config.apiKey) {
      res.status(503).json({ error: { code: 'setup', message: 'Interview start is unavailable. Check server configuration.', retryable: false } });
      return;
    }
    if ([...sessions.values()].filter(s => s.status !== 'ended').length >= 2) {
      res.status(429).json({ error: { code: 'busy', message: 'Both interviews are in use. Try again shortly.', retryable: true } });
      return;
    }
    const id = randomUUID();
    const sessionHandle = randomBytes(32).toString('base64url');
    const session: Session = {
      id, handleHash: hash(sessionHandle), status: 'starting', createdAt: Date.now(), deadlineAt: null,
      lastHeartbeat: Date.now(), attempted: false, abort: new AbortController(),
      controller: createTurnController(event => {
        if (!session.call) throw new Error('Realtime call is not ready.');
        session.call.send(event);
      }),
    };
    sessions.set(id, session);
    res.status(201).json({ sessionId: id, sessionHandle, challenge, maxDurationSeconds: 600 });
  });
  app.post('/api/sessions/:id/voice', async (req, res) => {
    const session = find(req, res);
    if (!session) return;
    const { offerSdp } = offer.parse(req.body);
    if (session.attempted || session.status !== 'starting') {
      res.status(409).json({ error: { code: 'state', message: 'Start a new interview to reconnect.', retryable: false } });
      return;
    }
    session.attempted = true;
    const onDisconnect = () => { if (!res.writableEnded) void end(session, 'Setup was interrupted.'); };
    res.on('close', onDisconnect);
    try {
      const call = await connect(offerSdp, {
        apiKey: config.apiKey, model: config.model, signal: session.abort.signal,
        onEvent(event) {
          session.controller.accept(event);
          if (event.type === 'error' && event.error.code !== 'response_cancel_not_active') {
            console.error(JSON.stringify({ sessionId: session.id, event: 'voice.provider_error', code: event.error.code }));
            void end(session, 'The voice provider reported an error. Start a new interview.');
          }
          if (event.type === 'response.done' && event.response.status === 'failed') {
            void end(session, 'The interviewer could not finish its response.');
          }
        },
        onFailure: () => { void end(session, 'The voice connection was lost. Start a new interview.'); },
      });
      session.call = call;
      if (session.abort.signal.aborted) {
        await call.close();
        res.status(409).json({ error: { code: 'ended', message: 'Interview ended during setup.', retryable: false } });
        return;
      }
      res.json({ answerSdp: call.answerSdp });
    } catch (error) {
      console.error(JSON.stringify({ sessionId: session.id, event: 'voice.setup_failed',
        status: error instanceof OpenAI.APIError ? error.status : undefined,
        code: error instanceof OpenAI.APIError ? error.code : error instanceof Error ? error.name : 'unknown' }));
      await end(session, 'Voice setup failed. Check the API key, model access, and network.');
      if (!res.destroyed) res.status(502).json({ error: { code: 'voice', message: session.error, retryable: false } });
    } finally {
      res.off('close', onDisconnect);
    }
  });
  app.post('/api/sessions/:id/heartbeat', (req, res) => {
    const session = find(req, res);
    if (!session) return;
    const { voiceConnected } = heartbeat.parse(req.body);
    session.lastHeartbeat = Date.now();
    if (voiceConnected && session.call && session.status === 'starting') {
      session.status = 'active';
      session.deadlineAt = Date.now() + 600_000;
      session.controller.start();
    } else if (!voiceConnected && session.status === 'active') {
      void end(session, 'The browser voice connection was lost.');
    }
    res.json(snapshot(session));
  });
  app.get('/api/sessions/:id', (req, res) => {
    const session = find(req, res);
    if (session) res.json(snapshot(session));
  });
  app.post('/api/sessions/:id/end', async (req, res) => {
    const session = find(req, res);
    if (!session) return;
    empty.parse(req.body);
    await end(session);
    res.json(snapshot(session));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'route', message: 'Not found.', retryable: false } }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const tooLarge = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    res.status(tooLarge ? 413 : invalid ? 400 : 500).json({ error: {
      code: tooLarge ? 'size' : invalid ? 'input' : 'server',
      message: invalid || tooLarge ? 'Invalid interview request.' : 'The server could not complete the request.', retryable: false,
    } });
  });
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (session.status === 'ended') {
        if (now - session.lastHeartbeat > 60_000) sessions.delete(session.id);
      } else if (session.deadlineAt && now >= session.deadlineAt) {
        void end(session, 'The ten-minute interview has ended.');
      } else if ((session.status === 'starting' && now - session.createdAt > 30_000) || now - session.lastHeartbeat > 45_000) {
        void end(session, 'The browser stopped responding.');
      }
    }
  }, 1000);
  sweep.unref();
  return {
    app,
    async close() {
      clearInterval(sweep);
      await Promise.all([...sessions.values()].map(s => end(s)));
      sessions.clear();
    },
  };
}
