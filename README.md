# MockMeister

A spoken system design interview with a browser-rendered 3D interviewer.
Choose from five ten-minute system-design discussions: URL Shortner, WhatsApp,
ChatGPT, Claude Code, or a scalable RAG system.

Milestones 1–3 implement OpenAI Realtime WebRTC, server-side turn control,
captions, and Excalidraw capture sent directly to the active Realtime interviewer.
Diagram evidence lives only for the active interview; PostgreSQL memory and final
evidence-based feedback are later milestones. This development slice listens
on localhost only.

## Run locally

Requires Node.js 24+ and an OpenAI project key with Realtime access.
PostgreSQL is not needed for this milestone.

```powershell
npm ci
Copy-Item .env.example .env
# Set OPENAI_API_KEY privately in .env.
npm run dev
```

Open http://localhost:3000 with a current desktop browser and headphones.
Start requests microphone access; no camera or account is required.
Vite updates client files during development. Restart the server after
changing server code or environment variables.

```powershell
npm test
npm run typecheck
npm run build
npm start
```

`npm start` serves the built client and API from the same Node process.

## Configuration

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Server-only project key; never prefix it with `VITE_` |
| `REALTIME_MODEL` | Defaults to `gpt-realtime-2.1-mini` |
| `PORT` | Defaults to `3000` |
| `PUBLIC_ORIGIN` | Exact browser origin, normally `http://localhost:3000` |
| `DEMO_ENABLED` | Must be `true` to admit interviews |

`.env` is ignored. Keep keys and session handles out of commits and screenshots.

## Voice and resource ownership

The browser sends its SDP offer to Express. The server creates the Realtime
call and attaches an authenticated sideband; the browser receives only the
SDP answer and an anonymous session handle. Microphone and generated audio
travel directly over WebRTC.

Server VAD commits candidate turns, while ordinary TypeScript schedules
responses. Generation and playback completion are tracked separately.
Interruption cancels generation and clears provider audio; the browser
detaches the avatar stream to discard its additional 150 ms playback buffer.
The next valid output event resumes playback. If the renderer or lip-sync
model fails, the same stream moves to a single ordinary audio element.
That transition happens once. Autoplay denial offers an explicit Enable sound
action; other plain-audio errors end the interview. There is no model switching,
automatic call reconnect, or chain of alternate implementations.

End stops local tracks, closes the peer and data channel, disposes playback,
and requests provider REST hangup. Setup errors, missed heartbeats, the
ten-minute deadline, and shutdown also terminate calls. Failed hangup
confirmation is reported explicitly. Transcripts exist only in process memory
in this milestone; application records are not durable yet. Assistant output
is conservatively not certified as heard evidence until playback receipts
are implemented for evaluation.

The character, lip-sync model, and notices are served locally. See
[avatar provenance and licenses](public/avatars/NOTICE.md).

## Verification and limits

[Milestone 1 verification](docs/MILESTONE_1_VERIFICATION.md) distinguishes local
automated checks, provider model lookup, and the required real-audio checks.
A successful build or model lookup does not prove a spoken exchange or lip sync.

Keep this slice local: public IP/daily admission limits, durable evidence,
retention cleanup, and deployment are later work. The current two-call cap
and ten-minute deadline do not make a public paid endpoint abuse-proof.

Design: [HLD](docs/HLD.md), [LLD](docs/LLD.md),
[implementation milestones](docs/IMPLEMENTATION_PLAN.md).
