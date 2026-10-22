import OpenAI from 'openai';
import WebSocket from 'ws';
import type { RealtimeClientEvent, RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import { instructions } from './challenge.ts';

export type VoiceCall = {
  answerSdp: string;
  send: (event: RealtimeClientEvent) => void;
  close: () => Promise<void>;
};

export type ConnectOptions = {
  apiKey: string;
  model: string;
  headset: boolean;
  signal: AbortSignal;
  onEvent: (event: RealtimeServerEvent) => void;
  onFailure: () => void;
};

export async function connectRealtime(offerSdp: string, options: ConnectOptions): Promise<VoiceCall> {
  const client = new OpenAI({ apiKey: options.apiKey, timeout: 20_000, maxRetries: 0 });
  const response = await client.realtime.calls.create({
    sdp: offerSdp,
    session: {
      type: 'realtime',
      model: options.model,
      instructions,
      output_modalities: ['audio'],
      max_output_tokens: 300,
      audio: {
        input: {
          noise_reduction: { type: options.headset ? 'near_field' : 'far_field' },
          transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
          turn_detection: { type: 'server_vad', create_response: false, interrupt_response: false,
            threshold: options.headset ? 0.5 : 0.65, silence_duration_ms: options.headset ? 500 : 700 },
        },
        output: { voice: 'cedar' },
      },
    },
  }, { signal: options.signal });

  const callId = response.headers.get('location')?.split('/').pop();
  if (!callId || !/^rtc_[\w-]+$/.test(callId)) {
    throw new Error('OpenAI did not return a valid Realtime call identifier.');
  }

  let socket: WebSocket | undefined;
  let closing: Promise<void> | undefined;
  function close() {
    closing ??= (async () => {
      options.signal.removeEventListener('abort', onAbort);
      try {
        await client.realtime.calls.hangup(callId!, { timeout: 5000, maxRetries: 1 });
      } catch (error) {
        if (!(error instanceof OpenAI.APIError && error.status === 404)) throw error;
      } finally {
        socket?.terminate();
      }
    })();
    return closing;
  }
  function onAbort() { void close().catch(options.onFailure); }
  options.signal.addEventListener('abort', onAbort, { once: true });

  try {
    if (options.signal.aborted) throw new Error('Setup was cancelled.');
    const answerSdp = await response.text();
    socket = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
      handshakeTimeout: 8000,
    });
    const sideband = socket;
    sideband.on('error', () => { if (!closing) options.onFailure(); });
    sideband.on('close', () => { if (!closing) options.onFailure(); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime sideband timed out.')), 8000);
      sideband.once('error', reject);
      sideband.once('close', () => reject(new Error('Realtime sideband closed during setup.')));
      sideband.on('message', data => {
        try {
          const event: RealtimeServerEvent = JSON.parse(data.toString());
          if (!event || typeof event.type !== 'string') {
            throw new Error('Invalid Realtime event.');
          }
          options.onEvent(event);
          if (event.type === 'session.created' || event.type === 'session.updated') {
            clearTimeout(timer);
            resolve();
          }
        } catch {
          reject(new Error('Invalid Realtime event.'));
          options.onFailure();
        }
      });
      sideband.once('open', () => sideband.send(JSON.stringify({
        type: 'session.update', session: { type: 'realtime', instructions },
      })));
      // A rejected handshake must not leave its timeout running.
      sideband.once('close', () => clearTimeout(timer));
      sideband.once('error', () => clearTimeout(timer));
    });
    if (options.signal.aborted) throw new Error('Setup was cancelled.');
    return {
      answerSdp,
      send(event) {
        if (closing || sideband.readyState !== WebSocket.OPEN) throw new Error('Realtime control is unavailable.');
        sideband.send(JSON.stringify(event));
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
