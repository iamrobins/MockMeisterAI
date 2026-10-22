import assert from 'node:assert/strict';
import test from 'node:test';
import { instructions } from '../server/challenge.ts';

test('interviewer instructions resist role reversal and echoed output', () => {
  assert.match(instructions, /always the interviewer, never the candidate or interviewee/);
  assert.match(instructions, /replay, quote, or echo of your own words/);
});

test('interviewer clarifies the prompt without solving the design', () => {
  assert.match(instructions, /scope, requirements, assumptions, or constraints directly and concisely/);
  assert.match(instructions, /do not give the solution/);
  assert.match(instructions, /focused clarifying or follow-up question instead/);
});
