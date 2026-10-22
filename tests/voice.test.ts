import assert from 'node:assert/strict';
import test from 'node:test';
import type { RealtimeClientEvent, RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import { createTurnLog, createTurnController } from '../shared/voice.ts';

let sequence = 0;
function event(type: string, fields: Record<string, unknown> = {}): RealtimeServerEvent {
  return { event_id: `event_${++sequence}`, type, ...fields } as RealtimeServerEvent;
}
function response(type: string, id: string, status = 'completed') {
  return event(type, { response: { id, status, output: [{ type: 'message', content: [{ type: 'output_audio' }] }] } });
}

test('finalized transcripts deduplicate by item and retain late ordering links', () => {
  const log = createTurnLog();
  const completed = event('conversation.item.input_audio_transcription.completed', { item_id: 'candidate_1', transcript: 'Use a cache.' });
  assert.equal(log.accept(completed), true);
  assert.equal(log.accept(completed), false);
  log.accept(event(completed.type, { item_id: 'candidate_1', transcript: 'duplicate' }));
  log.accept(event('input_audio_buffer.committed', { item_id: 'candidate_1', previous_item_id: 'question_1' }));
  assert.equal(log.turns.size, 1);
  assert.equal(log.turns.get('candidate_1')?.text, 'Use a cache.');
  assert.equal(log.turns.get('candidate_1')?.previousItemId, 'question_1');
});

test('late assistant transcript remains interrupted and is never certified as heard', () => {
  const log = createTurnLog();
  log.accept(response('response.created', 'reply_1'));
  log.accept(event('output_audio_buffer.started', { response_id: 'reply_1' }));
  log.accept(event('input_audio_buffer.speech_started'));
  log.accept(event('response.output_audio_transcript.done', { response_id: 'reply_1', item_id: 'question_1', transcript: 'How would you…' }));
  assert.equal(log.turns.get('question_1')?.interrupted, true);
  assert.equal(log.turns.get('question_1')?.heard, false);
});

test('server greets once, waits for commit and playback, and coalesces resumed speech', () => {
  const sent: RealtimeClientEvent[] = [];
  const voice = createTurnController(e => sent.push(e));
  voice.start(); voice.start();
  assert.deepEqual(sent.map(e => e.type), ['response.create']);
  voice.accept(response('response.created', 'greeting'));
  voice.accept(event('output_audio_buffer.started', { response_id: 'greeting' }));
  voice.accept(response('response.done', 'greeting'));
  voice.accept(event('input_audio_buffer.speech_started'));
  voice.accept(event('input_audio_buffer.speech_stopped'));
  voice.accept(event('input_audio_buffer.committed', { item_id: 'answer_1' }));
  assert.equal(sent.filter(e => e.type === 'response.create').length, 2);
  voice.accept(response('response.created', 'reply_1'));
  voice.accept(event('input_audio_buffer.speech_started'));
  assert.ok(sent.some(e => e.type === 'response.cancel'));
  assert.ok(sent.some(e => e.type === 'output_audio_buffer.clear'));
  voice.accept(response('response.done', 'reply_1', 'cancelled'));
  voice.accept(event('input_audio_buffer.committed', { item_id: 'answer_2' }));
  voice.accept(event('input_audio_buffer.committed', { item_id: 'answer_3' }));
  assert.equal(sent.filter(e => e.type === 'response.create').length, 2);
  voice.accept(event('input_audio_buffer.speech_stopped'));
  assert.equal(sent.filter(e => e.type === 'response.create').length, 3);
});

test('generation completion does not release a response before playback finishes', () => {
  const sent: RealtimeClientEvent[] = [];
  const voice = createTurnController(e => sent.push(e));
  voice.start();
  voice.accept(response('response.created', 'greeting'));
  voice.accept(response('response.done', 'greeting'));
  voice.accept(event('input_audio_buffer.committed', { item_id: 'answer_1' }));
  assert.equal(sent.length, 1);
  voice.accept(event('output_audio_buffer.started', { response_id: 'greeting' }));
  assert.equal(sent.length, 1);
  voice.accept(event('output_audio_buffer.stopped', { response_id: 'greeting' }));
  assert.equal(sent.filter(e => e.type === 'response.create').length, 2);
});

test('an observer request speaks once the current audio is finished', () => {
  const sent: RealtimeClientEvent[] = [];
  const voice = createTurnController(e => sent.push(e));
  voice.start();
  voice.accept(response('response.created', 'greeting'));
  voice.accept(event('output_audio_buffer.started', { response_id: 'greeting' }));
  voice.accept(response('response.done', 'greeting'));
  voice.request();
  assert.equal(sent.filter(e => e.type === 'response.create').length, 1);
  voice.accept(event('output_audio_buffer.stopped', { response_id: 'greeting' }));
  assert.equal(sent.filter(e => e.type === 'response.create').length, 2);
});

test('a duplicate commit does not request a second response after playback', () => {
  const sent: RealtimeClientEvent[] = [];
  const voice = createTurnController(e => sent.push(e));
  voice.start();
  voice.accept(response('response.done', 'greeting', 'cancelled'));
  voice.accept(event('input_audio_buffer.committed', { item_id: 'answer_1' }));
  voice.accept(response('response.done', 'reply_1', 'cancelled'));
  voice.accept(event('input_audio_buffer.committed', { item_id: 'answer_1' }));
  assert.equal(sent.filter(e => e.type === 'response.create').length, 2);
  voice.stop(); voice.stop();
  const count = sent.length;
  voice.accept(event('input_audio_buffer.committed', { item_id: 'answer_2' }));
  voice.accept(event('conversation.item.input_audio_transcription.completed', { item_id: 'answer_2', transcript: 'Late final words.' }));
  assert.equal(sent.length, count);
  assert.equal(voice.log.turns.get('answer_2')?.text, 'Late final words.');
});

test('interruption before response.created also cancels the late response', () => {
  const sent: RealtimeClientEvent[] = [];
  const voice = createTurnController(e => sent.push(e));
  voice.start();
  voice.accept(event('input_audio_buffer.speech_started'));
  voice.accept(event('input_audio_buffer.speech_stopped'));
  voice.accept(response('response.created', 'late_greeting'));
  voice.accept(event('output_audio_buffer.started', { response_id: 'late_greeting' }));
  assert.equal(sent.filter(e => e.type === 'response.cancel').length, 2);
  assert.equal(sent.at(-1)?.type, 'output_audio_buffer.clear');
});
