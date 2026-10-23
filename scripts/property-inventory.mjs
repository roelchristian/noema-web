// Explicit paths only. Never import openDatabase: it performs migrations.
import {DatabaseSync} from 'node:sqlite';
import {inventoryProperties} from '../src/server/modules/property-inventory.ts';
const [filename,vault,...extra]=process.argv.slice(2);
if(!filename||!vault||extra.length) {
 console.error('Usage: node --import tsx scripts/property-inventory.mjs <synthetic-or-exported.sqlite> <vault-id>');
 process.exitCode=2;
} else {
 const db=new DatabaseSync(filename,{readOnly:true});
 try {console.log(JSON.stringify(inventoryProperties(db,vault),null,2));}
 finally {db.close();}
}
