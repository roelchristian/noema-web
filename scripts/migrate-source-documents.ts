import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {Store} from '../src/server/store.js';
import {setupSourceDocumentSchema} from '../src/server/source-document-schema.js';
import {SourceDocuments} from '../src/server/modules/source-documents.js';

// Explicit vault selection prevents an accidental migration of unrelated vaults.
const args=process.argv.slice(2);
const value=(flag:string)=>{const index=args.indexOf(flag);return index>=0?args[index+1]:undefined;};
const vaultId=value('--vault');
if(!vaultId)throw new Error('Usage: node --import tsx scripts/migrate-source-documents.ts --vault <id> [--db <path>]');
const db=new DatabaseSync(resolve(value('--db')??'data/noema.sqlite'));
try {
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 const store=new Store(db);
 const vault=store.get<{id:string;name:string;locked:number}>('SELECT id,name,locked FROM vaults WHERE id=?',vaultId);
 if(!vault)throw new Error('The selected vault does not exist.');
 if(vault.locked)throw new Error('Unlock the selected vault before migration.');
 setupSourceDocumentSchema(db);
 const results=new SourceDocuments(store).migrate(vaultId);
 console.log(JSON.stringify({vault:{id:vault.id,name:vault.name},results},null,2));
}finally{db.close();}
