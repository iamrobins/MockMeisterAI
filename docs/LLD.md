# MockMeisterAI — Low-Level Design

Read [HLD](HLD.md) for system boundaries and trade-offs. This document records the implemented contracts.

## Code ownership

```text
client/
  App.tsx          page state, topic picker, interview and feedback UI
  voice.ts         WebRTC, microphone, client session lifecycle and captions
  playback.ts      avatar/audio ownership, interruption and fallback
  Whiteboard.tsx   Excalidraw capture and debounced board uploads
server/
  index.ts         environment, HTTP listener, dev/production asset serving
  app.ts           API routes, in-memory sessions, validation and cleanup
  realtime.ts      OpenAI Realtime call and authenticated sideband
  evaluation.ts    structured final feedback and citation validation
  challenge.ts     topic-specific interviewer instructions
shared/
  challenges.ts    allowed topic IDs and topic content
  voice.ts         turn log and response scheduling
  feedback.ts      feedback contract
```

## Session state

```ts
type Status = 'starting' | 'active' | 'finalizing' | 'completed' | 'failed';
```

A `POST /api/sessions` request creates a `starting` session and returns a UUID plus a random handle. The raw handle remains only in browser memory; the server stores its hash. A successful WebRTC offer/answer and heartbeat moves the session to `active` and starts the ten-minute deadline.

`end()` is idempotent: it changes state to `finalizing`, stops the turn controller, aborts the Realtime operation, closes the provider call, evaluates finalized candidate turns, and marks the session `completed` (or `failed` when an error message explains termination). A one-second sweep terminates expired or abandoned sessions and removes terminal sessions after inactivity.

## API

| Route | Contract |
| --- | --- |
| `GET /api/health` | Returns `{ ok, configured }`; no secret is exposed. |
| `POST /api/sessions` | Accepts `{ headset?, challengeId? }`; validates the allowlisted topic and returns session ID, handle, challenge, and 600-second maximum. |
| `POST /api/sessions/:id/voice` | Requires session handle and an audio SDP offer; returns the Realtime SDP answer once. |
| `POST /api/sessions/:id/heartbeat` | Requires `{ voiceConnected }`; establishes liveness and returns a snapshot. |
| `GET /api/sessions/:id` | Returns the current snapshot. |
| `GET /api/sessions/:id/events` | Opens an SSE stream with an initial snapshot and keepalives. |
| `POST /api/sessions/:id/board` | Accepts a versioned Excalidraw scene and PNG, validates it, and returns an acknowledgement or conflict. |
| `POST /api/sessions/:id/end` | Idempotently closes the interview and returns its snapshot. |

All session routes require `X-Interview-Session`. API mutations require an exact `Origin` matching `PUBLIC_ORIGIN`; API responses are `no-store`.

## Voice and response sequencing

The client gets microphone audio with echo cancellation, noise suppression, and automatic gain control, creates an SDP offer, then attaches the remote audio track to the avatar playback owner. A Realtime data channel supplies captions to the browser. The server separately attaches an authenticated WebSocket sideband to receive authoritative events and send controls.

`createTurnController` accepts provider events, keeps finalized turns, ignores filler/one-word candidate transcript turns, and schedules a single next response only after the previous output is safe to replace. Candidate speech that remains continuous long enough interrupts active interviewer audio. Playback tracks model audio separately from avatar playback so stale buffered audio does not resume after interruption.

## Board handling

The client waits four seconds after the last meaningful Excalidraw change and sends at most one capture every five seconds. The server accepts up to 500 elements and a 1.4 MB base64 field; decoded images must be valid PNGs up to 1600×1600 and at most 1 MB. Scene versioning and a fingerprint make retries safe and reject conflicting updates.

When a non-empty board is accepted, the server explicitly frames it as untrusted evidence, sends the image to the active Realtime call, and asks exactly one short question about a visible component or connection.

## Feedback contract

At interview end, the evaluator receives only finalized non-empty candidate turns for the selected topic. It produces:

```ts
type Feedback = {
  strengths: { text: string; citations: string[] }[];
  improvements: { text: string; citations: string[] }[];
  limitations: string[];
};
```

Zod validates the response. Every citation must refer to an actual candidate turn from that session; otherwise feedback is rejected. Evaluation failure preserves the transcript snapshot and returns a clear error instead of fabricated feedback.

## Limits and known boundaries

- 2 simultaneous non-terminal sessions
- 30-second setup timeout; 45-second missing-heartbeat timeout
- 10-minute active-session deadline
- in-memory state only; process restart loses active and completed sessions
- no accounts, persistence, cross-process coordination, or public rate/admission limits

The test suite covers session isolation, setup/end races, board-to-Realtime delivery, turn scheduling, transcript filtering, feedback citations, and playback fallback. Browser microphone, WebRTC networking, audible interruption, and avatar lip sync remain integration checks on the target host and device.
