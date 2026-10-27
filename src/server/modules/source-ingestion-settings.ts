import {Store} from '../store.js';
import {HttpError} from '../validation.js';

const key='source_ingestion_enabled';
/** Saved UI preference wins over the legacy startup flag, including an explicit off. */
export function sourceIngestionEnabled(store:Store,env:NodeJS.ProcessEnv=process.env) {
 const saved=store.get<{value:string}>('SELECT value FROM metadata WHERE key=?',key);
 return saved ? saved.value==='true' : env.NOEMA_PDF_PROVIDER_INGESTION==='1';
}
export function saveSourceIngestionSettings(store:Store,input:unknown) {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>name!=='enabled')||!('enabled' in input)||typeof input.enabled!=='boolean')throw new HttpError(400,'PDF provider processing must be on or off.');
 store.run('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,String(input.enabled));
 return {enabled:sourceIngestionEnabled(store)};
}
