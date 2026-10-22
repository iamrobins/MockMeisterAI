import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApp } from '../server/app.ts';
import type { ConnectOptions } from '../server/realtime.ts';
import type { RealtimeClientEvent } from 'openai/resources/realtime/realtime';

test('HTTP routes isolate sessions, control one call, and end it once', async t => {
  let options: ConnectOptions | undefined;
  let closes = 0;
  const commands: RealtimeClientEvent[] = [];
  const runtime = createApp({ apiKey: 'fixture-key', model: 'gpt-realtime-2.1-mini', workerModel: 'gpt-6-luna', publicOrigin: 'http://localhost:3000', demoEnabled: true }, async (_sdp, config) => {
    options = config;
    return { answerSdp: 'v=0\r\n', send: e => commands.push(e), close: async () => { ++closes; } };
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await runtime.close(); server.close(); server.closeAllConnections(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  async function post(path: string, body: unknown, handle?: string, origin = 'http://localhost:3000') {
    return fetch(base + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(handle ? { 'X-Interview-Session': handle } : {}) }, body: JSON.stringify(body) });
  }
  assert.equal((await post('/api/sessions', {}, undefined, 'https://other.example')).status, 403);
  assert.equal((await post('/api/sessions', { secret: 'unexpected' })).status, 400);
  const created = await post('/api/sessions', {});
  assert.equal(created.status, 201);
  const { sessionId, sessionHandle } = await created.json();
  const path = `/api/sessions/${sessionId}`;
  assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await post(`${path}/voice`, { offerSdp: 'v=0\r\nm=audio 9' }, 'wrong-handle')).status, 404);
  assert.equal((await post(`${path}/voice`, { offerSdp: 'invalid' }, sessionHandle)).status, 400);
  assert.equal((await post(`${path}/voice`, { offerSdp: 'v=0\r\nm=audio 9' }, sessionHandle)).status, 200);
  assert.equal(commands.length, 0);
  assert.equal((await post(`${path}/voice`, { offerSdp: 'v=0\r\nm=audio 9' }, sessionHandle)).status, 409);
  await post(`${path}/heartbeat`, { voiceConnected: true }, sessionHandle);
  await post(`${path}/heartbeat`, { voiceConnected: true }, sessionHandle);
  assert.deepEqual(commands.map(e => e.type), ['response.create']);
  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(0x49484452, 12); png.writeUInt32BE(40, 16); png.writeUInt32BE(40, 20);
  const board = { version: 1, capturedAt: new Date().toISOString(), elements: [{ id: 'cache', version: 1, versionNonce: 1 }], pngBase64: png.toString('base64') };
  assert.equal((await post(`${path}/board`, board, sessionHandle)).status, 202);
  const duplicate = await post(`${path}/board`, board, sessionHandle);
  assert.equal(duplicate.status, 202);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal((await post(`${path}/board`, { ...board, elements: [{ id: 'database', version: 1, versionNonce: 1 }] }, sessionHandle)).status, 409);
  options!.onEvent({ type: 'conversation.item.input_audio_transcription.completed', event_id: 'transcript_1', item_id: 'answer_1', transcript: 'Durable storage.', content_index: 0, usage: { type: 'duration', seconds: 1 } });
  options!.onEvent({ type: 'response.done', event_id: 'response_1', response: {
    id: 'greeting', status: 'incomplete', status_details: { type: 'incomplete', reason: 'max_output_tokens' }, output: [],
  } });
  const ongoing = await (await fetch(base + path, { headers: { 'X-Interview-Session': sessionHandle } })).json();
  assert.equal(ongoing.status, 'active');
  assert.equal(ongoing.error, undefined);
  const ended = await (await post(`${path}/end`, {}, sessionHandle)).json();
  assert.equal(ended.status, 'completed');
  assert.equal(ended.turns[0].text, 'Durable storage.');
  await post(`${path}/end`, {}, sessionHandle);
  assert.equal(closes, 1);
  assert.equal(options!.signal.aborted, true);
});

test('End racing with provider setup closes the late call and never greets', async t => {
  let finish: (() => void) | undefined;
  let started: (() => void) | undefined;
  const setupStarted = new Promise<void>(resolve => { started = resolve; });
  const setupPending = new Promise<void>(resolve => { finish = resolve; });
  let closes = 0;
  const runtime = createApp({ apiKey: 'fixture-key', model: 'gpt-realtime-2.1-mini', workerModel: 'gpt-6-luna', publicOrigin: 'http://localhost:3000', demoEnabled: true }, async () => {
    started!();
    await setupPending;
    return { answerSdp: 'v=0', send: () => assert.fail('Ended call must not speak'), close: async () => { ++closes; } };
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await runtime.close(); server.close(); server.closeAllConnections(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers: Record<string, string> = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
  const session = await (await fetch(base + '/api/sessions', { method: 'POST', headers, body: '{}' })).json();
  headers['X-Interview-Session'] = session.sessionHandle;
  const path = `${base}/api/sessions/${session.sessionId}`;
  const voice = fetch(path + '/voice', { method: 'POST', headers, body: JSON.stringify({ offerSdp: 'v=0\r\nm=audio 9' }) });
  await setupStarted;
  await fetch(path + '/end', { method: 'POST', headers, body: '{}' });
  finish!();
  assert.equal((await voice).status, 409);
  assert.equal(closes, 1);
});

test('observer discards stale work, processes the newest board, and clears a blank board', async t => {
  let resolveFirst!: (value: { nodes: []; edges: []; changes: string[]; uncertainties: [] }) => void;
  let calls = 0;
  const commands: RealtimeClientEvent[] = [];
  const first = new Promise<{ nodes: []; edges: []; changes: string[]; uncertainties: [] }>(resolve => { resolveFirst = resolve; });
  const runtime = createApp({
    apiKey: 'fixture-key', model: 'gpt-realtime-2.1-mini', workerModel: 'gpt-6-luna', publicOrigin: 'http://localhost:3000', demoEnabled: true,
    observer: async snapshot => ++calls === 1 ? first : { nodes: [], edges: [], changes: [`v${snapshot.version}`], uncertainties: [] },
  }, async () => ({ answerSdp: 'v=0', send: event => commands.push(event), close: async () => {} }));
  const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await runtime.close(); server.close(); server.closeAllConnections(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
  const session = await (await fetch(base + '/api/sessions', { method: 'POST', headers, body: '{}' })).json();
  const auth = { ...headers, 'X-Interview-Session': session.sessionHandle };
  const path = `${base}/api/sessions/${session.sessionId}`;
  await fetch(path + '/voice', { method: 'POST', headers: auth, body: JSON.stringify({ offerSdp: 'v=0\r\nm=audio 9' }) });
  await fetch(path + '/heartbeat', { method: 'POST', headers: auth, body: JSON.stringify({ voiceConnected: true }) });
  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(0x49484452, 12); png.writeUInt32BE(40, 16); png.writeUInt32BE(40, 20);
  const submit = (version: number, elements: unknown[]) => fetch(path + '/board', { method: 'POST', headers: auth, body: JSON.stringify({ version, capturedAt: new Date().toISOString(), elements, pngBase64: png.toString('base64') }) });
  await submit(1, [{ id: 'cache', version: 1, versionNonce: 1 }]);
  await submit(2, [{ id: 'database', version: 1, versionNonce: 1 }]);
  resolveFirst({ nodes: [], edges: [], changes: ['stale'], uncertainties: [] });
  await new Promise(resolve => setTimeout(resolve, 20));
  let state = await (await fetch(path, { headers: { 'X-Interview-Session': session.sessionHandle } })).json();
  assert.equal(state.diagram.snapshotVersion, 2); assert.deepEqual(state.diagram.changes, ['v2']);
  assert.ok(commands.some(event => event.type === 'session.update'));
  await submit(3, []);
  await new Promise(resolve => setTimeout(resolve, 20));
  state = await (await fetch(path, { headers: { 'X-Interview-Session': session.sessionHandle } })).json();
  assert.equal(state.diagram.snapshotVersion, 3); assert.deepEqual(state.diagram.nodes, []); assert.equal(calls, 2);
});
