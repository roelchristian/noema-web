import type {DatabaseSync} from 'node:sqlite';

export function setupSourceReprocessingCheckpointSchema(db:DatabaseSync){
db.exec(`CREATE TABLE IF NOT EXISTS source_reprocessing_synthesis (revision_id TEXT PRIMARY KEY REFERENCES source_reprocessing(id) ON DELETE CASCADE,payload TEXT NOT NULL CHECK(json_valid(payload)));`);
// Additive V2 checkpoints reference revisions; canonical source coordinates remain untouched.
db.exec(`CREATE TABLE IF NOT EXISTS source_reprocessing_chunks (
 revision_id TEXT NOT NULL REFERENCES source_reprocessing(id) ON DELETE CASCADE,
 chunk_index INTEGER NOT NULL CHECK(chunk_index BETWEEN 0 AND 127),payload TEXT NOT NULL CHECK(json_valid(payload)),
 PRIMARY KEY(revision_id,chunk_index));
 CREATE TABLE IF NOT EXISTS source_reprocessing_passes (
 revision_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,pass_index INTEGER NOT NULL CHECK(pass_index BETWEEN 1 AND 3),
 payload TEXT NOT NULL CHECK(json_valid(payload)),PRIMARY KEY(revision_id,chunk_index,pass_index),
 FOREIGN KEY(revision_id,chunk_index) REFERENCES source_reprocessing_chunks(revision_id,chunk_index) ON DELETE CASCADE);`);
}
