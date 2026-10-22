# MockMeister — Build plan for Codex

Read [HLD](HLD.md) for scope and [LLD](LLD.md) for contracts. These documents define the agreed implementation baseline; milestone progress is recorded separately.

## Rules for the implementation

The app is named **MockMeister**. Use this spelling in the page title, visible app header, and project README. Build the core interview directly. Keep Excalidraw's UI. No login, signup, accounts, dashboard, question catalogue, custom drawing tools, agent framework, vector store, or extra services. Keep one root package, one React client, one Node server, and PostgreSQL. Three model roles are enough; the orchestrator is ordinary TypeScript.

Implement the milestones in order. Each milestone ends with an observable working slice and a short verification note. Do not generate an entire application full of stubbed services. Use real provider integration as soon as the voice slice is ready; fixtures are for focused checks, not a fake hiring-manager demo.

## Milestone 1 — Prove live voice and the chosen avatar

This comes first because audio playback, interruption, and provider account access are the main integration uncertainties.

- Scaffold the minimal React/Vite/TypeScript client and Express/TypeScript server. Add the SDKs and peer dependencies needed for this slice only.
- Use server environment variables for the API key and voice model. Start with `REALTIME_MODEL=gpt-realtime-2.1-mini`; verify account access and current event schemas instead of copying old beta event names.
- Add Start/End, microphone capture, backend SDP negotiation, provider sideband, and direct WebRTC audio. Do not build STT → text model → TTS as a substitute.
- Use a demo Microsoft Rocketbox GLB from the selected Talking Avatar project, locally served as `/avatars/interviewer.glb`. Obtain the character file separately if it is not included in the npm package. Bundle the package's `viseme-model.bin` and explicitly pass its local `modelUrl`. Preserve the asset's provenance and license/attribution notices. Do not use the vendor's hosted avatar product.
- Connect the remote audio stream to the avatar as the sole playback owner. Add the plain-audio failure fallback.
- Prove server-controlled response creation, finalized transcripts, provider call termination, playback lifecycle, and barge-in. Check both provider buffering and the avatar's additional playback delay.
- Lock compatible versions and record the exact model/event contract that passed. Set `WORKER_MODEL=gpt-6-luna` for both supporting agents; check image input and structured outputs using the later milestones' fixtures. Model access/quality is a setup check, not a provider framework.

**Done:** a real spoken exchange works, the mouth follows the same audio, interruptions stop audible speech, End releases microphone/provider resources, and keys never enter the browser build. If the avatar cannot flush its delayed audio cleanly, resolve that integration here before moving on. Leave a small test for event mapping/deduplication and a manual audio verification note.

## Milestone 2 — Add the actual whiteboard and durable session memory

- Embed Excalidraw with its CSS and locally served fonts/assets; configure `EXCALIDRAW_ASSET_PATH` before the editor loads. Keep the page to the canvas, small avatar, captions, time, Mute, and End.
- Add session creation, event append/dedupe, scoped session handle, lifecycle states, and SSE status. Keep evidence in memory for the active browser session; PostgreSQL is intentionally deferred.
- Persist finalized candidate/interviewer turns, retaining provider ordering identifiers and heard/interrupted flags.
- Implement scene fingerprinting, debounced/throttled PNG capture, versioned native scene metadata, and snapshot persistence. Include the cleared-board case.
- Add the fixed URL-shortener brief, server deadline, and time-based phase preferences.

**Done:** a short voice-and-drawing session keeps ordered inspectable evidence while it is active, UI-only canvas actions do not generate captures, and the five-minute no-drawing scenario continues to record speech. Test duplicate events and version conflicts.

## Milestone 3 — Add the asynchronous Whiteboard Observer

- Implement one vision request with a strict output schema, scene metadata, previous interpretation, and explicit uncertainties.
- Add one in-flight job and one newest pending frame per session. No queue service.
- Apply only current-version observations and store stale-result reasons. Keep the last interpretation's version visible to the context builder.
- Push useful structured observation context to the voice session without creating a new spoken turn. Keep voice independent of vision latency.

**Done:** adding a cache produces a relevant follow-up at a natural candidate turn; ambiguous arrows cause clarification; a delayed v7 result cannot overwrite v8; observer failure leaves voice working. Add the stale-result and blank-scene tests before continuing.

## Milestone 4 — Add conversational memory and evaluation

- Run the evaluator at the LLD checkpoints to extract decisions, assumptions, hints, open questions, focus, and rubric coverage.
- Build bounded context from shared state; keep candidate-stated facts separate from visual inference.
- Add field-specific state application so a checkpoint cannot overwrite a newer diagram.
- Implement End/deadline finalization with bounded transcript/board drain, frozen evidence cutoff, and late-result rejection.
- Produce the final structured report and a plain evidence-linked feedback view. Validate all citations against provided evidence. Use null for insufficient evidence.

**Done:** with an unchanged diagram, the interviewer remembers a sharding explanation and asks about its consequences; corrected decisions supersede older claims; feedback cites actual candidate turns and diagram evidence. Test concurrent checkpoint/observer completion, invalid citations, and End during in-flight work.

## Milestone 5 — Make the public portfolio demo dependable

- Serve built client assets and API on one HTTPS origin with a long-running Node host and PostgreSQL, colocated or managed. Confirm the browser requests no avatar/model/font CDN assets during an interview; OpenAI is the only external AI service.
- Add short setup/liveness timeouts, ten-minute hard duration, two-session concurrency, IP/daily start caps, payload validation, and the operator start switch.
- Add the 24-hour application cleanup and one-line data notice. Ensure provider retention is not misrepresented.
- Run the complete flow on a desktop browser with real headphones/microphone. Verify fallback audio, blocked permissions, disconnects, page exit, deadline, and cleanup.
- Add a small project README with local run commands, environment variables, the architecture links, a screenshot, and measured demo limitations. No marketing site.
- Use one fixed transcript/frame fixture for a small single-model-vs-specialized-worker comparison. Save actual evidence-grounding, uncertainty, latency, and usage results; a CLI/manual run is sufficient.

**Done:** a fresh visitor can start without signing in, speak and draw, end, inspect feedback, and leave without an orphaned paid call. The repository tells a reviewer what actually works and what was measured.

## Environment and commands to establish

Keep configuration small: `OPENAI_API_KEY`, `REALTIME_MODEL`, `WORKER_MODEL`, `DATABASE_URL`, `PORT`, `PUBLIC_ORIGIN`, and `DEMO_ENABLED`. Store secrets in an ignored local `.env` and the host's secret settings; commit only `.env.example` placeholders. Session length and first-version limits can be constants in the server.

Use `REALTIME_MODEL=gpt-realtime-2.1-mini` and `WORKER_MODEL=gpt-6-luna` as the initial defaults. Use Node's built-in environment-file support instead of adding dotenv, and SQL migration files instead of an ORM. Keep the OpenAI SDK and the existing essential app packages; no additional AI vendor or agent runtime.

Establish `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run typecheck`, and `npm run db:migrate` as their functionality is introduced. Use native local PostgreSQL; Docker is not required.

### Local PostgreSQL installation status

Installed by the user and verified on 22 October 2026: PostgreSQL 18.6, Windows service `postgresql-x64-18` running, and `127.0.0.1:5432` accepting connections according to `pg_isready`. Command-line tools are available under `C:\Program Files\PostgreSQL\18\bin`; they are not on this session's PATH.

Local password authentication as `postgres` against the `postgres` database was verified on 22 October 2026. The password was not saved in project files. The application database/least-privileged role and `DATABASE_URL` are configured when the persistence milestone is implemented; application permissions remain untested. Keep database credentials server-side; they do not add a visitor login flow.

## First coding prompt

```text
Read docs/HLD.md, docs/LLD.md, and docs/IMPLEMENTATION_PLAN.md.
The app name is MockMeister; use it in the page title and app header.
Implement Milestone 1 only, including its verification.
Keep the result small: one React/Vite client and one Express server.
Use the real Talking Avatar open-source SDK and OpenAI Realtime WebRTC.
Use gpt-realtime-2.1-mini for voice and gpt-6-luna for later workers.
Serve the demo Rocketbox GLB and bundled viseme model locally.
Verify the current Realtime event schemas before wiring turn control.
No auth UI, dashboards, custom drawing UI, agent framework, or mock interview.
Do not begin later milestones until live audio, avatar lip sync,
interruption, and complete call cleanup have been verified.
Report what passed and which real-browser checks still need me.
```

## Unverified until implementation

The architecture follows the original chat and the linked integration documentation. No packages, paid model calls, GLB assets, live audio, deployment, or latency were tested while writing this plan. Avatar playback flushing and model access are deliberate first-milestone checks. A public demo without login still needs its small usage limits and does not guarantee zero unwanted spend.
