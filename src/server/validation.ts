export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function text(value: unknown, max = 10000): string {
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, 'Invalid text value');
  return value;
}
export function required(value: unknown, max = 200): string {
  const result = text(value, max).trim();
  if (!result) throw new HttpError(400, 'A name is required');
  return result;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Expected a JSON object');
  return value as Record<string, unknown>;
}
export const now = () => new Date().toISOString();
