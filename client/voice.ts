import type { RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import { createTurnLog } from '../shared/voice.ts';
import type { Turn } from '../shared/voice.ts';
import type { Feedback } from '../shared/feedback.ts';
import { createPlayback } from './playback.ts';
import { TalkingAvatar } from '@interviewflowai/talking-avatar';
import modelUrl from '@interviewflowai/talking-avatar/viseme-model.bin?url';

type Snapshot = { status: string; deadlineAt: number | null; turns: Turn[]; feedback?: Feedback; error?: string };
type Callbacks = {
  status: (value: string) => void;
  turns: (value: Turn[]) => void;
  deadline: (value: number) => void;
  notice: (value: string) => void;
  blocked: (value: boolean) => void;
  ended: () => void;
  session: (id: string, handle: string) => void;
  ready: () => void;
  feedback: (value: Feedback | undefined) => void;
};

export function createVoice(container: HTMLElement, callbacks: Callbacks) {
  const abort = new AbortController();
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel('oai-events');
  const playback = createPlayback(container, callbacks.notice, callbacks.blocked, onError => new TalkingAvatar({
    container, avatarUrl: '/avatars/interviewer.glb', modelUrl, streamDelayMs: 150, onError,
  }), message => { void end(message); });
  const log = createTurnLog();
  let mic: MediaStream | undefined;
  let sessionId: string | undefined;
  let handle: string | undefined;
  let closed = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let setupTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatPending = false;
  let connected = false;
  let closePromise: Promise<void> | undefined;

  async function request<T>(path: string, body?: unknown, keepalive = false): Promise<T> {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(handle ? { 'X-Interview-Session': handle } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: keepalive ? AbortSignal.timeout(30_000) : AbortSignal.any([abort.signal, AbortSignal.timeout(25_000)]),
      keepalive,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? 'Interview request failed.');
    return result;
  }

  function release() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    clearTimeout(setupTimer);
    abort.abort();
    mic?.getTracks().forEach(track => track.stop());
    peer.getReceivers().forEach(receiver => receiver.track?.stop());
    channel.close();
    peer.close();
    playback.dispose();
    window.removeEventListener('pagehide', leave);
  }

  async function end(message?: string) {
    if (closePromise) return closePromise;
    release();
    callbacks.status('Ending interview…');
    closePromise = (async () => {
      try {
        if (sessionId) {
          const snapshot = await request<Snapshot>(`/api/sessions/${sessionId}/end`, {}, true);
          callbacks.turns(snapshot.turns);
          callbacks.feedback(snapshot.feedback);
          if (snapshot.error) callbacks.notice(snapshot.error);
        }
        callbacks.status('Interview ended');
      } catch {
        callbacks.notice('Microphone stopped. Server cleanup is pending; its heartbeat timeout remains active.');
        callbacks.status('Interview ended');
      } finally {
        if (message) callbacks.notice(message);
        callbacks.ended();
      }
    })();
    return closePromise;
  }

  function leave() { void end(); }

  async function heartbeat() {
    if (closed || heartbeatPending || !sessionId) return;
    heartbeatPending = true;
    try {
      const snapshot = await request<Snapshot>(`/api/sessions/${sessionId}/heartbeat`, { voiceConnected: true });
      if (closed) return;
      if (snapshot.deadlineAt) callbacks.deadline(snapshot.deadlineAt);
      if (snapshot.status === 'active') callbacks.ready();
      if (snapshot.status === 'completed' || snapshot.status === 'failed') await end(snapshot.error);
    } catch (error) {
      if (!closed) await end(error instanceof Error ? error.message : 'Connection lost.');
    } finally {
      heartbeatPending = false;
    }
  }

  function maybeConnected() {
    if (closed || connected || peer.connectionState !== 'connected' || channel.readyState !== 'open') return;
    connected = true;
    clearTimeout(setupTimer);
    callbacks.status('Listening');
    void heartbeat();
    heartbeatTimer = setInterval(() => { void heartbeat(); }, 15_000);
  }

  channel.onopen = maybeConnected;
  channel.onclose = () => { if (!closed) void end('Voice control disconnected.'); };
  channel.onerror = () => { if (!closed) void end('Voice control failed.'); };
  channel.onmessage = ({ data }) => {
    if (closed) return;
    try {
      const event: RealtimeServerEvent = JSON.parse(data);
      if (!event || typeof event.type !== 'string') throw new Error('Invalid event');
      if (!log.accept(event)) return;
      playback.accept(event);
      callbacks.turns([...log.turns.values()]);
      if (event.type === 'input_audio_buffer.speech_started') callbacks.status('Listening');
      if (event.type === 'input_audio_buffer.speech_stopped') callbacks.status('Thinking…');
      if (event.type === 'output_audio_buffer.started') callbacks.status('Interviewer speaking');
      if (event.type === 'output_audio_buffer.stopped') callbacks.status('Listening');
    } catch { void end('The voice connection returned an invalid event.'); }
  };
  peer.ontrack = ({ track }) => { if (!closed && track.kind === 'audio') playback.setStream(new MediaStream([track])); };
  peer.onconnectionstatechange = () => {
    if (closed) return;
    if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) void end('Voice connection lost.');
    else maybeConnected();
  };

  async function start(headset: boolean) {
    setupTimer = setTimeout(() => { void end('Connection setup timed out. Please try again.'); }, 30_000);
    window.addEventListener('pagehide', leave);
    try {
      callbacks.status('Allow microphone access…');
      const captured = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (closed) { captured.getTracks().forEach(track => track.stop()); return; }
      mic = captured;
      await playback.ready;
      if (closed) return;
      callbacks.status('Connecting…');
      const session = await request<{ sessionId: string; sessionHandle: string }>('/api/sessions', { headset });
      sessionId = session.sessionId;
      handle = session.sessionHandle;
      callbacks.session(sessionId, handle);
      if (closed) { await request(`/api/sessions/${sessionId}/end`, {}, true); return; }
      mic.getAudioTracks().forEach(track => peer.addTrack(track, mic!));
      await peer.setLocalDescription(await peer.createOffer());
      const { answerSdp } = await request<{ answerSdp: string }>(`/api/sessions/${sessionId}/voice`, { offerSdp: peer.localDescription?.sdp });
      if (closed) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      maybeConnected();
    } catch (error) {
      if (!closed) await end(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it in your browser, then try again.'
        : error instanceof Error ? error.message : 'Interview setup failed.');
    }
  }

  return {
    start, end,
    mute(value: boolean) { mic?.getAudioTracks().forEach(track => { track.enabled = !value; }); },
    resumeAudio: () => playback.resume(),
  };
}
