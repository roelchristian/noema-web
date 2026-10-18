/** Request-scoped observer: never pass authorization headers into the trace. */
export interface AIUsageObserver { usage?: (usage: unknown) => void }
export interface AIDebugTrace extends AIUsageObserver {
  request(endpoint: string, payload: unknown): void;
  headers(status: number, headers: Record<string, string>): void;
  body(text: string): void;
  event(type: string, data: unknown): void;
  response(payload: unknown): void;
  error(message: string): void;
}
export type AIRequestObserver = (bytes: number) => AIDebugTrace | AIUsageObserver | void;
