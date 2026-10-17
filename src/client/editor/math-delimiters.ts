/** Completed inline expressions at the caret; escaped openers remain literal. */
export function inlineMathAtCaret(text: string) {
  const match = text.match(/(?<![\\$])\$(?![\s$])([^$\n]*?\S)\$$|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)$/);
  const source = (match?.[1] ?? match?.[2])?.trim();
  return match && source ? {index: match.index!, source} : undefined;
}
/** A standalone display equation, used for paste and live block conversion. */
export function displayMathSource(text: string): string | undefined {
  const match = text.trim().match(/^\$\$([\s\S]*?)\$\$$|^\\\[([\s\S]*?)(?<!\\)\\\]$/);
  const source = (match?.[1] ?? match?.[2])?.trim();
  return source || undefined;
}
