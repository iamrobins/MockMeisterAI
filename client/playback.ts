import type { TalkingAvatar } from '@interviewflowai/talking-avatar';
import type { RealtimeServerEvent } from 'openai/resources/realtime/realtime';

type Avatar = Pick<TalkingAvatar, 'ready' | 'attachStream' | 'detachStream' | 'setStatus' | 'dispose'>;

export function createPlayback(container: HTMLElement, notice: (message: string) => void, blocked: (value: boolean) => void,
  createAvatar: (onError: () => void) => Avatar, failed: (message: string) => void) {
  let avatar: Avatar | undefined;
  let audioOnly = false;
  let disposed = false;
  let stream: MediaStream | undefined;
  let playing = false;
  let speaking = false;
  let activeResponse: string | undefined;
  let epoch = 0;
  let attaching: Promise<void> | undefined;
  const interrupted = new Set<string>();
  const audio = new Audio();
  audio.autoplay = false;

  function flush() {
    ++epoch;
    avatar?.detachStream();
    audio.pause();
    audio.srcObject = null;
  }

  function fallback() {
    if (disposed || audioOnly) return false;
    audioOnly = true;
    flush();
    disposeAvatar();
    container.replaceChildren();
    notice('Avatar unavailable. Using audio only.');
    return true;
  }

  function disposeAvatar() {
    const previous = avatar;
    avatar = undefined;
    // The SDK assigns its AudioContext after worklet setup; wait so dispose can close it too.
    if (attaching) void attaching.catch(() => {}).then(() => previous?.dispose());
    else previous?.dispose();
  }

  async function attach() {
    if (disposed || !stream || !playing || speaking) return;
    let token = ++epoch;
    if (avatar) {
      try {
        attaching = avatar.attachStream(stream);
        await attaching;
        if (token === epoch && !disposed) blocked(false);
        return;
      } catch (error) {
        if (token !== epoch || disposed) return;
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          flush();
          blocked(true);
          return;
        }
        fallback();
        token = epoch;
      }
    }
    try {
      audio.srcObject = stream;
      await audio.play();
      if (token === epoch && !disposed) blocked(false);
    } catch (error) {
      if (token !== epoch || disposed) return;
      flush();
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        blocked(true);
      } else {
        playing = false;
        failed('Audio playback failed. Check your browser sound settings, then start a new interview.');
      }
    }
  }

  const ready = (async () => {
    try {
      avatar = createAvatar(() => {
        if (fallback()) void attach();
      });
      await avatar.ready;
    } catch {
      fallback();
    }
  })();

  return {
    ready,
    setStream(value: MediaStream) { stream = value; void attach(); },
    resume() { return attach(); },
    accept(event: RealtimeServerEvent) {
      if (disposed) return;
      switch (event.type) {
        case 'response.created':
          activeResponse = event.response.id;
          avatar?.setStatus('thinking');
          break;
        case 'input_audio_buffer.speech_started':
          speaking = true;
          if (activeResponse) interrupted.add(activeResponse);
          playing = false;
          flush();
          avatar?.setStatus('listening');
          break;
        case 'input_audio_buffer.speech_stopped':
          speaking = false;
          avatar?.setStatus('thinking');
          break;
        case 'output_audio_buffer.cleared':
          interrupted.add(event.response_id);
          if (event.response_id === activeResponse) { playing = false; flush(); }
          break;
        case 'output_audio_buffer.started':
          if (speaking || interrupted.has(event.response_id)) return;
          activeResponse = event.response_id;
          playing = true;
          void attach();
          break;
        case 'output_audio_buffer.stopped':
          // Keep the stream attached so the avatar can finish its extra 150 ms of buffered speech.
          avatar?.setStatus('listening');
          break;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      flush();
      disposeAvatar();
      stream = undefined;
      audio.remove();
      container.replaceChildren();
    },
  };
}
