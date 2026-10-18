import { SourcePolicy } from './SourcePolicy';
import { request, uploadSourceFile } from '../api';
import type { SourceFile } from '../../shared/domain';
import { Select } from '../components/Select';
import { useState, type FormEvent } from 'react';
import { entityLabels, entityTypes, type EntityInput, type EntityType } from '../../shared/domain';
import {DomainPicker} from './DomainPicker';
import { SubtypePicker } from './SubtypePicker';
import { useEntitySchema } from './useEntitySchema';
import { Modal, ModalHeader } from '../components/Modal';
import { Icon } from '../components/Icon';
import { AliasInput, parseAliases } from './AliasInput';
export interface CreateEntityRequest {intent?: 'insert'; name?: string; source?: boolean; excludeSources?: boolean; onCreated?: (id: string) => void}
export function CreateEntityDialog({vaultId, initial, onSubmit, onClose}: {vaultId: string; initial: CreateEntityRequest; onSubmit: (input: EntityInput) => Promise<void>; onClose: () => void}) {
  const [name, setName] = useState(initial.name || ''), [type, setType] = useState<EntityType>(initial.source ? 'source' : 'person');
  const allowedTypes = entityTypes.filter(type => initial.source ? type === 'source' : !initial.excludeSources || type !== 'source');
  const {schema, error: schemaError} = useEntitySchema(vaultId);
  const [domainIds, setDomainIds] = useState<string[]>([]);
  const [subtypes, setSubtypes] = useState<string[]>([]);
  const [sourceFile,setSourceFile]=useState<File|null>(null),[sourceUrl,setSourceUrl]=useState('');
  const [stagedSource,setStagedSource]=useState<SourceFile|null>(null);
  const [aliases, setAliases] = useState('');
  const [sourceMethod,setSourceMethod]=useState<''|'file'|'url'>('');
  const [nameEdited,setNameEdited]=useState(!!initial.name);
  let suggestedName=sourceFile?.name.slice(0,200)??'';
  if(sourceMethod==='url') {
    try {
      const url=new URL(sourceUrl);
      suggestedName=(decodeURIComponent(url.pathname.split('/').at(-1)??'')||url.hostname).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,220);
      if(!/\.(txt|md|pdf)$/i.test(suggestedName))suggestedName+='.txt';
      suggestedName=suggestedName.slice(0,200);
    }catch{suggestedName='';}
  }
  const resolvedName=type==='source'&&!nameEdited?suggestedName:name;
  const sourceReady=sourceMethod==='file'?!!sourceFile:sourceMethod==='url'?!!sourceUrl.trim():false;
  function selectFile(file:File|null) {
    setStagedSource(null);setError('');setSourceFile(null);
    if(!file)return;
    if(!/\.(txt|md|pdf)$/i.test(file.name)){setError('Choose a TXT, MD, or PDF file.');return;}
    if(!file.size||file.size>50*1024*1024){setError('Choose a nonempty file of 50 MB or smaller.');return;}
    setSourceFile(file);
  }
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if(busy||!allowedTypes.includes(type)||(type==='source'?!sourceReady:!resolvedName.trim()))return;
    setBusy(true);setError('');
    try {
      let source=stagedSource;
      if(type==='source'&&!source) {
        source=sourceMethod==='file'
          ? await uploadSourceFile(vaultId,sourceFile!)
          : await request<SourceFile>('source-files/url','POST',{url:sourceUrl.trim()},vaultId);
        setStagedSource(source);
      }
      await onSubmit({name:resolvedName.trim()||source?.name.slice(0,200)||'',aliases:type==='source'?[]:parseAliases(aliases),type,subtypes,...(type==='concept'?{domainIds}:{}),...(type==='source'&&source?{attachmentIds:[source.id]}:{})});
      onClose();
    }catch(error){setError(error instanceof Error?error.message:String(error));}
    finally { setBusy(false); }
  }
  const namePlaceholder: Partial<Record<EntityType,string>> = {person:'e.g. Ursula K. Le Guin',place:'e.g. Kyoto',organization:'e.g. The Royal Society',event:'e.g. World Expo 2025',creativework:'e.g. The Left Hand of Darkness',organism:'e.g. Ginkgo biloba',culture:'e.g. Japanese',concept:'e.g. Systems thinking',source:'e.g. Interview with Ursula K. Le Guin'};
  return <Modal className="create-entity-dialog" onClose={() => { if (!busy) onClose(); }} titleId="create-dialog-title"><form onSubmit={submit}>
    <ModalHeader titleId="create-dialog-title" leading={<Icon name={type}/>} closeDisabled={busy}>{initial.intent==='insert'?'Create and insert':initial.source ? 'New source' : 'New entity'}</ModalHeader><p className="modal-description">{initial.intent==='insert'?'Add an entity and keep writing.':initial.source?'Add a document to your Sources library.':'Add to your knowledge library.'}</p>
    <div className="create-entity-fields">
      {!initial.source&&<label>Entity type<Select aria-label="Entity type" value={type} onChange={e => { setType(e.target.value as EntityType); setSubtypes([]); setDomainIds([]); setSourceFile(null); setSourceUrl(''); setStagedSource(null); setSourceMethod(''); setError(''); }} disabled={busy}>{allowedTypes.map(t => <option key={t} value={t}>{entityLabels[t]}</option>)}</Select></label>}
      {type==='source'&&<label>Add source from (required)<Select aria-label="Add source from" required value={sourceMethod} onChange={event=>{setSourceMethod(event.target.value as 'file'|'url');setSourceFile(null);setSourceUrl('');setStagedSource(null);setError('');}} disabled={busy}><option value="" disabled>Choose file or URL</option><option value="file">File</option><option value="url">URL</option></Select></label>}
      {type==='source'&&sourceMethod&&<section className="source-attachments">
        {sourceMethod==='file'
          ? <label className="source-upload">Choose source file<input type="file" required accept=".txt,.md,.pdf" aria-label="Choose source file" disabled={busy} onChange={event=>selectFile(event.target.files?.[0]??null)}/></label>
          : <label>Source URL<input type="url" inputMode="url" required value={sourceUrl} onChange={event=>{setSourceUrl(event.target.value);setStagedSource(null);setError('');}} disabled={busy} placeholder="https://example.com/article"/></label>}
        <SourcePolicy method={sourceMethod}/>
      </section>}

      <label>Name<input autoFocus={type!=='source'} required={type!=='source'} maxLength={200} value={resolvedName} onChange={e => {setName(e.target.value);setNameEdited(true);}} disabled={busy} placeholder={type==='source'?'Uses the source filename':namePlaceholder[type] ?? 'Entity name'} autoComplete="off"/></label>
      <SubtypePicker type={type} value={subtypes} subtypes={schema.subtypes} onChange={setSubtypes} disabled={busy}/>
      {type==='concept'&&<DomainPicker value={domainIds} onChange={setDomainIds} disabled={busy}/>}
      {type!=='source'&&<AliasInput value={aliases} onChange={setAliases} disabled={busy}/>}
      {schemaError && <p className="dialog-error" role="alert">{schemaError}</p>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
    </div>
    <footer className="dialog-actions create-entity-actions"><button type="button" className="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy||(type==='source'?!sourceReady:!resolvedName.trim())}>{busy?'Creating…':initial.intent==='insert'?'Create and insert':initial.source?'Create source':'Create entity'}</button></footer>
  </form></Modal>;
}
