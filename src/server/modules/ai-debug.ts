/** Request-scoped observer: never pass authorization headers into the trace. */
export interface AIUsageObserver { usage?: (usage: unknown) => void }
export interface AIStreamSummary {
  eventCount: number;
  textDeltaCount: number;
  textBytes: number;
  transportBytes: number;
  firstOutputMs: number | null;
  completedMs: number;
  terminalEvent: string | null;
  interrupted: boolean;
  outputExcerpt?: string;
  outputBytes?: number;
  events: Record<string, {count:number; bytes:number; firstMs:number; lastMs:number}>;
}
export interface AIDebugTrace extends AIUsageObserver {
  mode?: 'compact' | 'full';
  stream?: (summary: AIStreamSummary) => void;
  request(endpoint: string, payload: unknown): void;
  headers(status: number, headers: Record<string, string>): void;
  body(text: string): void;
  event(type: string, data: unknown): void;
  response(payload: unknown): void;
  error(message: string): void;
}
export type AIRequestObserver = (bytes: number) => AIDebugTrace | AIUsageObserver | void;
