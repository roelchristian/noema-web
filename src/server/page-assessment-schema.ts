import type {DatabaseSync} from 'node:sqlite';
import {CLASSIFICATION_VERSION} from './modules/page-semantic-drift.js';
import {TAXONOMY_VERSION} from '../shared/domains.js';

/** Invalidate through the existing preparation queue, including imports/restores and background vectors. */
export function setupPageAssessmentSchema(db:DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS page_assessment_vectors (
    page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,generation INTEGER NOT NULL DEFAULT 0);`);
  const enqueue=(selection:string)=>`INSERT INTO page_enrichment_jobs(page_id,vault_id,fields,explicit,due_at,attempts,generation,updated_at)
    SELECT p.id,p.vault_id,'["title","domains","language","summary"]',0,unixepoch('subsec')*1000+12000,0,1,unixepoch('subsec')*1000 FROM pages p WHERE p.deleted_at IS NULL AND p.archived_at IS NULL AND (${selection})
    ON CONFLICT(page_id) DO UPDATE SET fields=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(page_enrichment_jobs.fields) UNION SELECT value FROM json_each(excluded.fields))),due_at=MIN(page_enrichment_jobs.due_at,excluded.due_at),generation=page_enrichment_jobs.generation+1,updated_at=excluded.updated_at;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS page_assessment_content AFTER UPDATE OF title,blocks,archived_at,deleted_at ON pages
    WHEN OLD.title IS NOT NEW.title OR OLD.blocks IS NOT NEW.blocks OR OLD.archived_at IS NOT NEW.archived_at OR OLD.deleted_at IS NOT NEW.deleted_at BEGIN
    DELETE FROM page_enrichment_jobs WHERE page_id=NEW.id AND (NEW.deleted_at IS NOT NULL OR NEW.archived_at IS NOT NULL);
    ${enqueue('p.id=NEW.id')} END;`);
  for(const event of ['INSERT','UPDATE','DELETE']) {
    const row=event==='DELETE'?'OLD':'NEW';
    // An explicit generation counter catches replacement within the same timestamp and vector deletion.
    db.exec(`CREATE TRIGGER IF NOT EXISTS page_assessment_vector_${event.toLowerCase()} AFTER ${event} ON page_segment_embeddings BEGIN
      INSERT INTO page_assessment_vectors(page_id,generation) SELECT page_id,1 FROM page_segments WHERE id=${row}.segment_id
      ON CONFLICT(page_id) DO UPDATE SET generation=generation+1;
      ${enqueue(`p.id=(SELECT page_id FROM page_segments WHERE id=${row}.segment_id)`)} END;`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS page_assessment_domains_${event.toLowerCase()} AFTER ${event} ON page_domains BEGIN
      ${enqueue(`p.id=${row}.page_id`)} END;`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS page_assessment_assignment_${event.toLowerCase()} AFTER ${event} ON page_domain_state BEGIN
      ${enqueue(`p.id=${row}.page_id`)} END;`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS page_assessment_segment_delete BEFORE DELETE ON page_segments BEGIN
    INSERT INTO page_assessment_vectors(page_id,generation) SELECT id,1 FROM pages WHERE id=OLD.page_id
    ON CONFLICT(page_id) DO UPDATE SET generation=generation+1;
    ${enqueue('p.id=OLD.page_id')} END;
    CREATE TRIGGER IF NOT EXISTS page_assessment_entity_delete BEFORE DELETE ON entities BEGIN
    ${enqueue('p.id IN (SELECT page_id FROM page_mentioned_entities WHERE entity_id=OLD.id)')} END;
    CREATE TRIGGER IF NOT EXISTS page_assessment_entity_insert AFTER INSERT ON entities BEGIN
    ${enqueue('p.id IN (SELECT page_id FROM page_mentioned_entities WHERE entity_id=NEW.id)')} END;`);
  // Mentions without a display override depend on entity names/case. The existing mention index bounds the fan-out.
  db.exec(`CREATE TRIGGER IF NOT EXISTS page_assessment_entity AFTER UPDATE OF name,mention_case ON entities
    WHEN OLD.name IS NOT NEW.name OR OLD.mention_case IS NOT NEW.mention_case BEGIN
    ${enqueue('p.id IN (SELECT page_id FROM page_mentioned_entities WHERE entity_id=NEW.id)')} END;
    CREATE TRIGGER IF NOT EXISTS page_assessment_index AFTER DELETE ON page_index_dirty BEGIN
    ${enqueue('p.id=OLD.page_id')} END;`);
  // Reassess legacy/stored records once after a policy release; reads never perform migrations.
  const version=JSON.stringify([1,CLASSIFICATION_VERSION,TAXONOMY_VERSION]);
  const saved=db.prepare("SELECT value FROM metadata WHERE key='page-assessment-policy'").get() as {value:string}|undefined;
  if(saved?.value!==version) {
    db.exec(enqueue('1'));
    db.prepare("INSERT INTO metadata(key,value) VALUES ('page-assessment-policy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(version);
  }
}
