export type Feedback = {
  strengths: { text: string; citations: string[] }[];
  improvements: { text: string; citations: string[] }[];
  limitations: string[];
};
