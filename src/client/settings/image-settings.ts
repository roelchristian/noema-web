export const imageSettingsKey = 'noema.images.v1';
export function parseImageCompression(raw: string | null): boolean {
  try { return JSON.parse(raw || 'null')?.autoCompress !== false; } catch { return true; }
}
export function readImageCompression(): boolean {
  try { return parseImageCompression(localStorage.getItem(imageSettingsKey)); } catch { return true; }
}
