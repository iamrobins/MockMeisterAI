export const challenges = [
  { id: 'url-shortener', title: 'Design URL Shortner', summary: 'Create short links that redirect quickly and reliably.', opening: "Let's design a URL shortener today. What requirements would you clarify first?", focus: 'Cover requirements, data model, create and redirect flows, scale, and failure. The fixed scale constraints are 10 million new links/day, 100 redirects per new link, and five-year retention. Prioritize fast, available redirects. Link creation must acknowledge a durable mapping.' },
  { id: 'whatsapp', title: 'Design WhatsApp', summary: 'Build reliable real-time messaging for people and groups.', opening: "Let's design WhatsApp today. What requirements would you clarify first?", focus: 'Cover requirements, one-to-one and group messaging, ordering, delivery, offline sync, scale, and failure.' },
  { id: 'chatgpt', title: 'Design ChatGPT', summary: 'Build a responsive, safe conversational AI product.', opening: "Let's design ChatGPT today. What requirements would you clarify first?", focus: 'Cover requirements, conversation state, model serving, latency, safety, scale, and failure.' },
  { id: 'claude-code', title: 'Design Claude Code', summary: 'Build a coding agent that works safely in developer environments.', opening: "Let's design Claude Code today. What requirements would you clarify first?", focus: 'Cover requirements, repository context, tool execution, isolation, safety, latency, scale, and failure.' },
  { id: 'scalable-rag', title: 'Design a Scalable RAG', summary: 'Build retrieval-augmented answers over a growing knowledge base.', opening: "Let's design a scalable RAG system today. What requirements would you clarify first?", focus: 'Cover requirements, ingestion, indexing, retrieval, answer generation, evaluation, scale, and failure.' },
] as const;

export type Challenge = typeof challenges[number];
export type ChallengeId = Challenge['id'];
export const challengeIds = challenges.map(challenge => challenge.id) as [ChallengeId, ...ChallengeId[]];
export const defaultChallenge = challenges[0];

export function getChallenge(id: ChallengeId) {
  return challenges.find(challenge => challenge.id === id) ?? defaultChallenge;
}
