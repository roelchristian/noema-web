import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'noema.sqlite');
if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, title TEXT NOT NULL, blocks TEXT NOT NULL, updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS properties (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, name TEXT NOT NULL, value TEXT, target_id TEXT REFERENCES entities(id) ON DELETE CASCADE, CHECK ((value IS NULL) != (target_id IS NULL)));
 CREATE TABLE IF NOT EXISTS relationships (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, label TEXT NOT NULL, target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE);
 CREATE INDEX IF NOT EXISTS properties_entity ON properties(entity_id);
 CREATE INDEX IF NOT EXISTS relationships_source ON relationships(source_id);
 CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);`);
const now = () => new Date().toISOString();
const types = ['person', 'place', 'event', 'creativework', 'organization'];
const blockTypes = ['paragraph', 'heading1', 'heading2', 'bullet', 'quote', 'todo'];
const txt = (value, max = 10000) => { if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text value'); return value; };
const required = (value, max = 200) => { const result = txt(value, max).trim(); if (!result) throw new Error('A name is required'); return result; };
const entity = id => db.prepare('SELECT * FROM entities WHERE id=?').get(id);
const page = id => { const p = db.prepare('SELECT * FROM pages WHERE id=?').get(id); return p && { ...p, blocks: JSON.parse(p.blocks) }; };
const entityDetail = id => {
 const e = entity(id); if (!e) return null;
 return { ...e, properties: db.prepare('SELECT * FROM properties WHERE entity_id=?').all(id), relationships: db.prepare('SELECT * FROM relationships WHERE source_id=? OR target_id=?').all(id, id), incomingProperties: db.prepare('SELECT * FROM properties WHERE target_id=?').all(id) };
};
function validateBlocks(blocks) {
 if (!Array.isArray(blocks) || blocks.length > 2000) throw new Error('Invalid blocks');
 return blocks.map(b => {
  if (!blockTypes.includes(b.type) || !Array.isArray(b.content) || b.content.length > 1000) throw new Error('Invalid block');
  return { id: required(b.id), type: b.type, checked: !!b.checked, content: b.content.map(s => {
   if (s.entityId) { const id = required(s.entityId); if (!entity(id)) throw new Error('Referenced entity does not exist'); return { entityId: id }; }
   return { text: txt(s.text) };
  }) };
 });
}
if (!db.prepare("SELECT value FROM metadata WHERE key='seeded'").get()) {
 db.exec('BEGIN');
 try {
 const add = db.prepare('INSERT INTO entities (id,name,type,description,updated_at) VALUES (?,?,?,?,?)');
 add.run('ursula', 'Ursula K. Le Guin', 'person', 'American author of speculative fiction, poetry, and essays.', now());
 add.run('earthsea', 'A Wizard of Earthsea', 'creativework', 'A coming-of-age novel about language, balance, and the power of names.', now());
 add.run('berkeley', 'Berkeley', 'place', 'A city in California, on the eastern shore of San Francisco Bay.', now());
 add.run('theodora', 'Theodora Kroeber', 'person', 'American writer and anthropologist; mother of Ursula K. Le Guin.', now());
 db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run(randomUUID(), 'earthsea', 'type', 'Book', null);
 db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run(randomUUID(), 'earthsea', 'author', null, 'ursula');
 db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run(randomUUID(), 'ursula', 'birthplace', null, 'berkeley');
 db.prepare('INSERT INTO relationships VALUES (?,?,?,?)').run(randomUUID(), 'ursula', 'child of', 'theodora');
 const block = (type, content) => ({ id: randomUUID(), type, content: typeof content === 'string' ? [{ text: content }] : content });
 const blocks = [block('paragraph', 'A small space for connected thinking. Write freely, collect ideas, and give the people, places, and works in your notes a life of their own.'), block('heading2', 'Everything starts with a connection'), block('paragraph', [{text:'I’m reading '},{entityId:'earthsea'},{text:' by '},{entityId:'ursula'},{text:'. There’s something compelling about a world in which knowing a true name means understanding its nature.'}]), block('quote', 'To light a candle is to cast a shadow.'), block('heading2', 'A few things to try'), block('bullet', 'Type / on an empty line to choose a block: heading, list, quote, or to-do.'), block('bullet', 'Type @ to reference a knowledge entity, or create a new one.'), block('bullet', 'Click a highlighted entity to explore its properties and connections.'), block('todo', 'Add a connection of your own'), block('paragraph', [])];
 db.prepare('INSERT INTO pages VALUES (?,?,?,?)').run('welcome', 'A place for connected ideas', JSON.stringify(blocks), now());
 db.prepare("INSERT INTO metadata VALUES ('seeded','1')").run();
 db.exec('COMMIT');
 } catch(e) { db.exec('ROLLBACK'); throw e; }
}
const server = http.createServer(async (req, res) => {
 const send = (status, data) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
 try {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
   // Reject cross-origin browser writes to this local-only service.
   if (!['GET','HEAD'].includes(req.method) && ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site')) return send(403, {error:'Cross-origin writes are not allowed'});
   let body = {};
   if (['POST','PUT'].includes(req.method)) {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2_000_000) return send(413,{error:'Request too large'}); }
    try { body = JSON.parse(raw); } catch { return send(400,{error:'Invalid JSON'}); }
   }
   const parts = url.pathname.split('/').filter(Boolean); const [, collection, id, child, childId] = parts;
   if (collection === 'pages' && !id && req.method === 'GET') return send(200, db.prepare('SELECT id,title,updated_at FROM pages ORDER BY updated_at DESC').all());
   if (collection === 'pages' && !id && req.method === 'POST') {
    const id = randomUUID(); db.prepare('INSERT INTO pages VALUES (?,?,?,?)').run(id, required(body.title || 'Untitled'), JSON.stringify([{id:randomUUID(),type:'paragraph',content:[]}]), now()); return send(201, page(id));
   }
   if (collection === 'pages' && id && parts.length === 3) {
    if (!page(id)) return send(404,{error:'Page not found'});
    if (req.method === 'GET') return send(200,page(id));
    if (req.method === 'PUT') { db.prepare('UPDATE pages SET title=?,blocks=?,updated_at=? WHERE id=?').run(txt(body.title,500), JSON.stringify(validateBlocks(body.blocks)), now(), id); return send(200,page(id)); }
    if (req.method === 'DELETE') { db.prepare('DELETE FROM pages WHERE id=?').run(id); return send(200,{ok:true}); }
   }
   if (collection === 'entities' && !id && req.method === 'GET') return send(200, db.prepare('SELECT * FROM entities ORDER BY name COLLATE NOCASE').all());
   if (collection === 'entities' && !id && req.method === 'POST') {
    if (!types.includes(body.type)) throw new Error('Invalid entity type'); const id = randomUUID();
    db.prepare('INSERT INTO entities VALUES (?,?,?,?,?)').run(id, required(body.name), body.type, txt(body.description || ''), now()); return send(201,entityDetail(id));
   }
   if (collection === 'entities' && id) {
    if (!entity(id)) return send(404,{error:'Entity not found'});
    if (parts.length === 3) {
     if (req.method === 'GET') return send(200,entityDetail(id));
     if (req.method === 'PUT') { if (!types.includes(body.type)) throw new Error('Invalid entity type'); db.prepare('UPDATE entities SET name=?,type=?,description=?,updated_at=? WHERE id=?').run(required(body.name), body.type, txt(body.description || ''),now(),id); return send(200,entityDetail(id)); }
    }
    if (child === 'properties' && parts.length === 4 && req.method === 'POST') {
     const target = body.target_id ? required(body.target_id) : null; if (target && !entity(target)) throw new Error('Target entity not found');
     db.prepare('INSERT INTO properties VALUES (?,?,?,?,?)').run(randomUUID(),id,required(body.name), target ? null : txt(body.value),target); return send(201,entityDetail(id));
    }
    if (child === 'relationships' && parts.length === 4 && req.method === 'POST') {
     const target = required(body.target_id); if (!entity(target)) throw new Error('Target entity not found');
     db.prepare('INSERT INTO relationships VALUES (?,?,?,?)').run(randomUUID(), id, required(body.label), target); return send(201,entityDetail(id));
    }
    if (child === 'properties' && parts.length === 5 && req.method === 'PUT') {
     const target = body.target_id ? required(body.target_id) : null; if (target && !entity(target)) throw new Error('Target entity not found');
     const result = db.prepare('UPDATE properties SET name=?,value=?,target_id=? WHERE id=? AND entity_id=?').run(required(body.name), target ? null : txt(body.value), target, childId, id);
     return result.changes ? send(200,entityDetail(id)) : send(404,{error:'Property not found'});
    }
    if (child === 'relationships' && parts.length === 5 && req.method === 'PUT') {
     const target = required(body.target_id); if (!entity(target)) throw new Error('Target entity not found');
     const result = db.prepare('UPDATE relationships SET label=?,target_id=? WHERE id=? AND source_id=?').run(required(body.label),target,childId,id);
     return result.changes ? send(200,entityDetail(id)) : send(404,{error:'Relationship not found'});
    }
    if (['properties','relationships'].includes(child) && parts.length === 5 && req.method === 'DELETE') {
     const column = child === 'properties' ? 'entity_id' : 'source_id';
     db.prepare(`DELETE FROM ${child} WHERE id=? AND ${column}=?`).run(childId,id); return send(200,entityDetail(id));
    }
   }
   return send(404,{error:'Not found'});
  }
  if (!['GET','HEAD'].includes(req.method)) return send(405,{error:'Method not allowed'});
  const files = {'/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/style.css':['style.css','text/css']};
  const file = files[url.pathname]; if (!file) return send(404,{error:'Not found'});
  res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"}); res.end(readFileSync(path.join(root,'public',file[0])));
 } catch (error) { if (error.code?.startsWith('ERR_SQLITE')) { console.error(error); send(400,{error:'The data could not be saved'}); } else send(400,{error:error.message}); }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, '127.0.0.1', () => console.log(`Noema is running at http://localhost:${server.address().port}\nSQLite: ${dbPath}`));
