import assert from 'node:assert/strict';
import test from 'node:test';
import { instructions, instructionsFor } from '../server/challenge.ts';
import { getChallenge } from '../shared/challenges.ts';

test('interviewer instructions resist role reversal and echoed output', () => {
  assert.match(instructions, /always the interviewer, never the candidate or interviewee/);
  assert.match(instructions, /replay, quote, or echo of your own words/);
});

test('interviewer clarifies the prompt without solving the design', () => {
  assert.match(instructions, /scope, requirements, assumptions, or constraints directly and concisely/);
  assert.match(instructions, /do not give the solution/);
  assert.match(instructions, /focused clarifying or follow-up question instead/);
});

test('each selected challenge supplies its own interviewer context', () => {
  const selected = instructionsFor(getChallenge('scalable-rag'));
  assert.match(selected, /Design a Scalable RAG/);
  assert.match(selected, /ingestion, indexing, retrieval/);
});
