# Milestone 1 verification

Updated 22 October 2026. Implementation is limited to voice and avatar playback.
Real-audio acceptance remains pending until the checklist below is exercised.

## Automated checks

- `npm test`: 15 passing tests for transcript/event deduplication, late ordering
  links, interrupted output, server response scheduling, playback-vs-generation
  completion, session isolation, End/setup races, avatar attachment/disposal,
  a single audio downgrade, terminal audio failure, explicit autoplay recovery,
  and GLB content.
- `npm run typecheck`: passed against the installed SDK types.
- `npm run build`: passed. Vite reports a large client chunk because it includes
  React, Three.js, and the avatar SDK; splitting has not been optimized.
- Initial `npm install`: 107 packages installed; audit reported no vulnerabilities
  at installation time. Exact versions and integrity hashes are in `package-lock.json`.
- Local development HTTP: page, health route, Rocketbox GLB, and license return 200.
- Built production server: page, health route, GLB, and license return 200;
  disabling `DEMO_ENABLED` rejects session creation with 503. No provider calls
  were made during that smoke check.
- Browser build scan: the configured API key is absent from all nine output files.
- Actual configured key: model lookup for `gpt-realtime-2.1-mini` succeeded.
  This does not establish Realtime session creation or audio quality.

The user attempted a manual interview during development. Detailed observations
have not yet been supplied, so the real-audio checklist remains unchecked.

## Integration contract

OpenAI SDK `7.39.0`; Talking Avatar `0.1.3`; Three.js `0.186.0`.
Voice model: `gpt-realtime-2.1-mini`. Input transcription uses OpenAI
`gpt-4o-mini-transcribe` within the Realtime session for captions, not as a
replacement speech-to-text/text-model/text-to-speech pipeline.

The [official Realtime WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime)
and [server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime)
were consulted alongside the installed SDK schemas. This implementation uses
`POST /v1/realtime/calls`, its `Location` call identifier, the authenticated
`wss://api.openai.com/v1/realtime?call_id=...` sideband, and
[`POST /v1/realtime/calls/{call_id}/hangup`](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup).
It does not send GPT-Live commands such as `session.close`.

Selected events: `input_audio_buffer.speech_started`,
`input_audio_buffer.speech_stopped`, `input_audio_buffer.committed`,
`conversation.item.input_audio_transcription.completed`,
`response.output_audio_transcript.done`, `response.created`, `response.done`,
and `output_audio_buffer.started/stopped/cleared`.
Commands: `session.update`, `response.create`, `response.cancel`, and
`output_audio_buffer.clear`.

The SDK's `detachStream()` disconnects its audio source and delay node and
invalidates pending attachments. Source inspection supports the chosen flush
path; only a real audible test can validate interruption timing end to end.

Character source: https://talking-avatar.dev/avatars/male.glb.
SHA-256: `734c481e7c0f3ff2572ac3ee1e837cdb8da4c112a9d267d5941d698299e1d8c0`.
The GLB contains all fifteen Oculus mouth shapes and no external image/buffer URLs.

## Real browser acceptance

Use a desktop browser, headphones, the real microphone, and the configured key.
Record browser/device and actual timing observations; do not infer passes from
the automated tests.

- [ ] Start: one brief greeting, microphone active, model speech audible, mouth follows it.
- [ ] Respond: candidate and interviewer finalized captions appear; one response per turn.
- [ ] Interrupt during a long reply: audible speech stops promptly, the mouth settles,
      old words do not resume, and the next reply answers the interruption.
- [ ] Compare response latency including the avatar's configured 150 ms delay.
- [ ] Mute/unmute: microphone transmission stops/resumes without duplicate playback.
- [ ] End while speaking: microphone indicator clears and avatar/audio/connection stop.
- [ ] End during setup and retry: no late greeting or second playback owner.
- [ ] Deny microphone: readable error and a clean retry.
- [ ] Block the GLB/model request: plain audio works with an explicit fallback notice.
- [ ] Block autoplay: Enable sound recovers from a user click.
- [ ] Close the tab or interrupt the network: server hangup runs; no orphaned paid call.
- [ ] Leave idle: ten-minute server deadline terminates the call.
- [ ] Network panel: GLB/model load from this origin, no avatar/model CDN requests.

No milestone beyond this voice slice has been started.
