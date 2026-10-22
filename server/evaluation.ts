import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { Turn } from '../shared/voice.ts';
import type { Feedback } from '../shared/feedback.ts';
import type { Challenge } from '../shared/challenges.ts';

const finding = z.object({ text: z.string().min(1).max(500), citations: z.array(z.string().min(1)).min(1).max(3) }).strict();
export const feedbackSchema = z.object({
  strengths: z.array(finding).max(3),
  improvements: z.array(finding).max(3),
  limitations: z.array(z.string().min(1).max(500)).max(3),
}).strict();

export function validateFeedback(feedback: Feedback, turns: Turn[]) {
  const candidateIds = new Set(turns.filter(turn => turn.role === 'candidate' && turn.text.trim()).map(turn => turn.itemId));
  for (const finding of [...feedback.strengths, ...feedback.improvements]) {
    if (finding.citations.some(id => !candidateIds.has(id))) throw new Error('Evaluator returned an invalid transcript citation.');
  }
  return feedback as Feedback;
}

export function translateCitations(feedback: Feedback, citations: Map<string, string>) {
  for (const finding of [...feedback.strengths, ...feedback.improvements]) {
    finding.citations = finding.citations.map(citation => {
      const itemId = citations.get(citation);
      if (!itemId) throw new Error('Evaluator returned an invalid transcript citation.');
      return itemId;
    });
  }
  return feedback;
}

export function createEvaluator(apiKey: string, model: string) {
  const client = new OpenAI({ apiKey });
  return async (turns: Turn[], topic: Challenge) => {
    const evidence = turns.filter(turn => turn.role === 'candidate' && turn.text.trim()).map((turn, index) => ({ citation: `turn-${index + 1}`, itemId: turn.itemId, text: turn.text }));
    const response = await client.responses.parse({
      model,
      store: false,
      input: `Evaluate this ${topic.title} interview using only the finalized candidate transcript below. Do not infer missing details. When the transcript contains substantive candidate answers, return one to three cited strengths and/or improvements; an interview does not need to be complete to have useful evidence. Use improvements to identify missing design detail, citing the candidate turn that shows the partial approach. Use limitations only when no substantive candidate transcript exists. Cite each strength and improvement with one or more exact citation labels. Citation labels are internal: never include them or raw item IDs in reader-facing text or limitations. Keep feedback concise.\n\n${JSON.stringify(evidence.map(({ citation, text }) => ({ citation, text })))}`,
      text: { format: zodTextFormat(feedbackSchema, 'interview_feedback') },
    });
    const feedback = feedbackSchema.parse(response.output_parsed);
    return validateFeedback(translateCitations(feedback, new Map(evidence.map(({ citation, itemId }) => [citation, itemId]))), turns);
  };
}
