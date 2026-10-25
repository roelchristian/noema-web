import type {DatabaseSync} from 'node:sqlite';
/** Additive and idempotent; Chat history is deliberately outside every text/vector index. */
export function setupChatSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS chat_threads (
 id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 title TEXT NOT NULL, scope_json TEXT NOT NULL CHECK(json_valid(scope_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS chat_threads_vault ON chat_threads(vault_id,updated_at);
 CREATE TABLE IF NOT EXISTS chat_messages (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), UNIQUE(thread_id,sequence));
 CREATE TABLE IF NOT EXISTS chat_evidence (
 message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE, evidence_id TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), PRIMARY KEY(message_id,evidence_id));
 CREATE TABLE IF NOT EXISTS chat_requests (
 vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE, request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
 thread_id TEXT REFERENCES chat_threads(id) ON DELETE CASCADE, result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 PRIMARY KEY(vault_id,request_id));`);
}
