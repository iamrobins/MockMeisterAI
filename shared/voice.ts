import type { RealtimeServerEvent, RealtimeClientEvent } from 'openai/resources/realtime/realtime';

export type Turn = {
  itemId: string;
  previousItemId?: string | null;
  responseId?: string;
  role: 'candidate' | 'interviewer';
  text: string;
  interrupted: boolean;
  heard: boolean;
};

export function createTurnLog() {
  const turns = new Map<string, Turn>();
  const previous = new Map<string, string | null>();
  const interrupted = new Set<string>();
  const seen = new Set<string>();
  let activeResponse: string | undefined;

  return {
    turns,
    accept(event: RealtimeServerEvent) {
      if ('event_id' in event) {
        if (seen.has(event.event_id)) return false;
        seen.add(event.event_id);
      }
      switch (event.type) {
        case 'conversation.item.added':
        case 'conversation.item.created':
        case 'input_audio_buffer.committed': {
          const id = event.type === 'input_audio_buffer.committed' ? event.item_id : event.item.id;
          if (id) {
            previous.set(id, event.previous_item_id ?? null);
            const turn = turns.get(id);
            if (turn) turn.previousItemId = event.previous_item_id ?? null;
          }
          break;
        }
        case 'response.created':
          activeResponse = event.response.id;
          break;
        case 'output_audio_buffer.started':
          activeResponse = event.response_id;
          break;
        case 'input_audio_buffer.speech_started':
        case 'output_audio_buffer.cleared':
          if (event.type === 'output_audio_buffer.cleared') activeResponse = event.response_id;
          if (activeResponse) {
            interrupted.add(activeResponse);
            for (const turn of turns.values()) {
              if (turn.responseId === activeResponse) {
                turn.interrupted = true;
                turn.heard = false;
              }
            }
          }
          break;
        case 'output_audio_buffer.stopped':
          // shortcut: no browser playback receipt yet; add one before using heard hints in evaluation.
          activeResponse = undefined;
          break;
        case 'conversation.item.input_audio_transcription.completed':
        case 'response.output_audio_transcript.done': {
          if (turns.has(event.item_id)) break;
          const responseId = event.type === 'response.output_audio_transcript.done' ? event.response_id : undefined;
          turns.set(event.item_id, {
            itemId: event.item_id,
            previousItemId: previous.get(event.item_id),
            responseId,
            role: responseId ? 'interviewer' : 'candidate',
            text: event.transcript,
            interrupted: responseId ? interrupted.has(responseId) : false,
            heard: !responseId,
          });
          break;
        }
      }
      return true;
    },
  };
}

export function createTurnController(send: (event: RealtimeClientEvent) => void) {
  const log = createTurnLog();
  let ready = false;
  let stopped = false;
  let speaking = false;
  let generating = false;
  let playing = false;
  let awaitingPlayback = false;
  let pending = false;
  let responseId: string | undefined;
  let cancelRequested = false;
  const cancelled = new Set<string>();
  const drained = new Set<string>();
  const committed = new Set<string>();

  function schedule() {
    if (!ready || stopped || speaking || generating || playing || awaitingPlayback || !pending) return;
    pending = false;
    generating = true;
    responseId = undefined;
    cancelRequested = false;
    send({ type: 'response.create' });
  }

  function interrupt() {
    if (generating) cancelRequested = true;
    if (generating) send({ type: 'response.cancel' });
    if (generating || playing || awaitingPlayback) send({ type: 'output_audio_buffer.clear' });
    if (responseId) cancelled.add(responseId);
    playing = false;
    awaitingPlayback = false;
  }

  return {
    log,
    start() {
      if (ready || stopped) return;
      ready = true;
      pending = true;
      schedule();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      interrupt();
    },
    accept(event: RealtimeServerEvent) {
      if (!log.accept(event) || stopped) return;
      switch (event.type) {
        case 'input_audio_buffer.speech_started':
          speaking = true;
          interrupt();
          break;
        case 'input_audio_buffer.speech_stopped':
          speaking = false;
          break;
        case 'input_audio_buffer.committed':
          if (committed.has(event.item_id)) break;
          committed.add(event.item_id);
          pending = true;
          break;
        case 'response.created':
          responseId = event.response.id;
          generating = true;
          if (speaking || cancelRequested) interrupt();
          break;
        case 'output_audio_buffer.started':
          if (speaking || cancelled.has(event.response_id)) {
            send({ type: 'output_audio_buffer.clear' });
          } else {
            playing = true;
            awaitingPlayback = false;
          }
          break;
        case 'output_audio_buffer.cleared':
        case 'output_audio_buffer.stopped':
          drained.add(event.response_id);
          playing = false;
          awaitingPlayback = false;
          break;
        case 'response.done':
          generating = false;
          awaitingPlayback = event.response.status === 'completed' && !playing &&
            !cancelled.has(event.response.id ?? '') &&
            !drained.has(event.response.id ?? '') &&
            Boolean(event.response.output?.some(item => item.type === 'message' &&
              item.content?.some(part => part.type === 'output_audio')));
          break;
      }
      schedule();
    },
  };
}
