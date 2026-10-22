import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvaluator, translateCitations, validateFeedback } from '../server/evaluation.ts';

const turns = [{ itemId: 'candidate_1', role: 'candidate' as const, text: 'Use a cache.', interrupted: false, heard: true }];

test('feedback rejects citations outside finalized candidate turns', () => {
  assert.throws(() => validateFeedback({
    strengths: [{ text: 'Good cache choice.', citations: ['interviewer_1'] }], improvements: [], limitations: [],
  }, turns), /invalid transcript citation/);
  assert.doesNotThrow(() => validateFeedback({
    strengths: [{ text: 'Good cache choice.', citations: ['candidate_1'] }], improvements: [], limitations: [],
  }, turns));
});

test('feedback translates reader-safe citation labels before validation', () => {
  const feedback = translateCitations({
    strengths: [{ text: 'Good cache choice.', citations: ['turn-1'] }], improvements: [], limitations: [],
  }, new Map([['turn-1', 'candidate_1']]));
  assert.deepEqual(feedback.strengths[0]?.citations, ['candidate_1']);
  assert.throws(() => translateCitations({
    strengths: [{ text: 'Good cache choice.', citations: ['item_secret'] }], improvements: [], limitations: [],
  }, new Map()), /invalid transcript citation/);
});

test('evaluation prompt requires findings from a substantive transcript', () => {
  const source = createEvaluator.toString();
  assert.match(source, /return one to three cited strengths and\/or improvements/);
  assert.match(source, /Use limitations only when no substantive candidate transcript exists/);
});
