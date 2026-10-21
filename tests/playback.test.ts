import assert from 'node:assert/strict';
import test from 'node:test';
import type { RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import { createPlayback } from '../client/playback.ts';

test('interruption detaches delayed audio and rejects stale output before resuming a new reply', async t => {
  class AudioFixture {
    autoplay = false;
    srcObject: unknown = null;
    pause() {}
    play() { return Promise.resolve(); }
    remove() {}
  }
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'Audio', { value: AudioFixture, configurable: true });
  t.after(() => { if (previousAudio) Object.defineProperty(globalThis, 'Audio', previousAudio); else Reflect.deleteProperty(globalThis, 'Audio'); });
  let attached = 0;
  let detached = 0;
  let disposed = 0;
  const playback = createPlayback({ replaceChildren() {} } as unknown as HTMLElement, () => {}, () => {}, () => ({
    ready: Promise.resolve(), attachStream: async () => { ++attached; },
    detachStream: () => { ++detached; }, setStatus() {}, dispose: () => { ++disposed; },
  }), message => assert.fail(message));
  await playback.ready;
  const send = (type: string, responseId?: string) => playback.accept({
    type, event_id: `event_${type}`, response_id: responseId, response: { id: responseId },
  } as RealtimeServerEvent);
  playback.setStream({} as MediaStream);
  send('response.created', 'old');
  send('output_audio_buffer.started', 'old');
  assert.equal(attached, 1);
  send('input_audio_buffer.speech_started');
  assert.equal(detached, 1);
  send('input_audio_buffer.speech_stopped');
  send('output_audio_buffer.started', 'old');
  assert.equal(attached, 1);
  send('response.created', 'new');
  send('output_audio_buffer.started', 'new');
  assert.equal(attached, 2);
  playback.dispose(); playback.dispose();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(disposed, 1);
});

test('renderer failure uses one plain audio owner and releases it on End', async t => {
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  let plays = 0;
  let pauses = 0;
  let element: { srcObject: unknown };
  Object.defineProperty(globalThis, 'Audio', { value: class {
    srcObject: unknown = null;
    constructor() { element = this; }
    pause() { ++pauses; }
    play() { ++plays; return Promise.resolve(); }
    remove() {}
  }, configurable: true });
  t.after(() => { if (previousAudio) Object.defineProperty(globalThis, 'Audio', previousAudio); else Reflect.deleteProperty(globalThis, 'Audio'); });
  const notices: string[] = [];
  const playback = createPlayback({ replaceChildren() {} } as unknown as HTMLElement, message => notices.push(message), () => {}, () => { throw new Error('WebGL unavailable'); }, message => assert.fail(message));
  await playback.ready;
  const stream = {} as MediaStream;
  playback.setStream(stream);
  playback.accept({ type: 'output_audio_buffer.started', event_id: 'start', response_id: 'reply' });
  assert.equal(plays, 1);
  assert.equal(element!.srcObject, stream);
  assert.equal(notices.length, 1);
  playback.dispose();
  assert.ok(pauses > 0);
  assert.equal(element!.srcObject, null);
});

test('End during attachment waits for the SDK audio context before disposing it', async t => {
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'Audio', { value: class { pause() {} remove() {} }, configurable: true });
  t.after(() => { if (previousAudio) Object.defineProperty(globalThis, 'Audio', previousAudio); else Reflect.deleteProperty(globalThis, 'Audio'); });
  let resolveAttach: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { resolveAttach = resolve; });
  let disposed = 0;
  let detached = 0;
  const playback = createPlayback({ replaceChildren() {} } as unknown as HTMLElement, () => {}, () => {}, () => ({
    ready: Promise.resolve(), attachStream: () => pending,
    detachStream: () => { ++detached; }, setStatus() {}, dispose: () => { ++disposed; },
  }), message => assert.fail(message));
  await playback.ready;
  playback.setStream({} as MediaStream);
  playback.accept({ type: 'output_audio_buffer.started', event_id: 'start', response_id: 'reply' });
  playback.dispose();
  assert.equal(detached, 1);
  assert.equal(disposed, 0);
  resolveAttach!();
  await pending; await Promise.resolve(); await Promise.resolve();
  assert.equal(disposed, 1);
});

for (const autoplay of [true, false]) {
  test(autoplay ? 'autoplay denial waits for an explicit click' : 'ordinary audio failure ends playback without retrying', async t => {
    const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
    let plays = 0;
    Object.defineProperty(globalThis, 'Audio', { value: class {
      pause() {}
      remove() {}
      play() {
        ++plays;
        return plays === 1 ? Promise.reject(autoplay
          ? new DOMException('User gesture required', 'NotAllowedError') : new Error('Audio device failed')) : Promise.resolve();
      }
    }, configurable: true });
    t.after(() => { if (previousAudio) Object.defineProperty(globalThis, 'Audio', previousAudio); else Reflect.deleteProperty(globalThis, 'Audio'); });
    const blocked: boolean[] = [];
    const failures: string[] = [];
    const playback = createPlayback({ replaceChildren() {} } as unknown as HTMLElement, () => {}, value => blocked.push(value),
      () => { throw new Error('WebGL unavailable'); }, message => failures.push(message));
    await playback.ready;
    playback.setStream({} as MediaStream);
    playback.accept({ type: 'output_audio_buffer.started', event_id: 'start', response_id: 'reply' });
    await Promise.resolve();
    assert.equal(plays, 1);
    assert.equal(failures.length, autoplay ? 0 : 1);
    assert.equal(blocked.includes(true), autoplay);
    await playback.resume();
    assert.equal(plays, autoplay ? 2 : 1);
    playback.dispose();
  });
}

test('SDK notification and ready rejection produce only one audio downgrade', async t => {
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'Audio', { value: class { pause() {} remove() {} }, configurable: true });
  t.after(() => { if (previousAudio) Object.defineProperty(globalThis, 'Audio', previousAudio); else Reflect.deleteProperty(globalThis, 'Audio'); });
  let reportError: (() => void) | undefined;
  let notices = 0;
  let disposals = 0;
  const playback = createPlayback({ replaceChildren() {} } as unknown as HTMLElement, () => { ++notices; }, () => {}, onError => {
    reportError = onError;
    return { ready: Promise.reject(new Error('Avatar load failed')), attachStream: async () => {},
      detachStream() {}, setStatus() {}, dispose() { ++disposals; } };
  }, message => assert.fail(message));
  reportError!(); reportError!();
  await playback.ready;
  assert.equal(notices, 1);
  assert.equal(disposals, 1);
  playback.dispose();
});
