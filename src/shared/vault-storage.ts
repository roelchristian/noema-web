export const storageCategories = ['attachments', 'sources', 'notes', 'entities', 'indexes', 'other'] as const;
export type StorageCategory = typeof storageCategories[number];
export interface VaultStorageItem {
  id: string;
  name: string;
  detail: string;
  bytes: number;
}
export interface VaultStorage {
  items?: VaultStorageItem[];
  totalBytes: number;
  fileBytes: number;
  dataBytes: number;
  categories: {id: StorageCategory; bytes: number}[];
}
