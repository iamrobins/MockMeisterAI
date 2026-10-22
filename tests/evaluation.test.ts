import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFeedback } from '../server/evaluation.ts';

const turns = [{ itemId: 'candidate_1', role: 'candidate' as const, text: 'Use a cache.', interrupted: false, heard: true }];

test('feedback rejects citations outside finalized candidate turns', () => {
  assert.throws(() => validateFeedback({
    strengths: [{ text: 'Good cache choice.', citations: ['interviewer_1'] }], improvements: [], limitations: [],
  }, turns), /invalid transcript citation/);
  assert.doesNotThrow(() => validateFeedback({
    strengths: [{ text: 'Good cache choice.', citations: ['candidate_1'] }], improvements: [], limitations: [],
  }, turns));
});
