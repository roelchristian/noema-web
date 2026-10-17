export const summaryWordLimit = 75;

/** Keep Markdown whitespace intact while enforcing a conservative word budget. */
export function limitSummaryWords(text: string): string {
  const words = [...text.matchAll(/\S+/gu)];
  if (words.length <= summaryWordLimit) return text.trim();
  const last = words[summaryWordLimit - 1]!;
  return text.slice(0, last.index + last[0].length).trimEnd();
}
