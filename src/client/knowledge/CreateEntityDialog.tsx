import {BibliographyImport} from './BibliographyImport';
import {SourcePdfProcessing,initialPdfIngestionOptions} from './SourcePdfProcessing';
import type {SourceIngestionOptions} from '../../shared/source-ingestion';
import {ReferentStatusPicker} from './ReferentStatusPicker';
import {maxSourceBytes,pastedSourceFilename,validatePastedSourceText} from '../../shared/source-input';
import {t as uiText} from '../i18n';
import { SourcePolicy } from './SourcePolicy';
import { request, uploadSourceFile } from '../api';
import type { SourceFile } from '../../shared/domain';
import { Select } from '../components/Select';
import { useRef, useState, type FormEvent } from 'react';
import { entityLabels, entityTypes, type ReferentStatus, type EntityInput, type EntityType } from '../../shared/domain';
import {DomainPicker} from './DomainPicker';
import { SubtypePicker } from './SubtypePicker';
import { useEntitySchema } from './useEntitySchema';
import { Modal, ModalHeader } from '../components/Modal';
import { Icon } from '../components/Icon';
import { AliasInput, parseAliases } from './AliasInput';
export interface CreateEntityRequest {intent?: 'insert'; name?: string; source?: boolean; excludeSources?: boolean; onCreated?: (id: string) => void; onCancel?: () => void; onBibliographyCreated?:()=>Promise<void>}
export function CreateEntityDialog({vaultId, initial, onSubmit, onClose}: {vaultId: string; initial: CreateEntityRequest; onSubmit: (input: EntityInput) => Promise<void>; onClose: () => void}) {
  const [name, setName] = useState(initial.name || ''), [type, setType] = useState<EntityType>(initial.source ? 'source' : 'person');
  const allowedTypes = entityTypes.filter(type => initial.source ? type === 'source' : !initial.excludeSources || type !== 'source');
  const {schema, error: schemaError} = useEntitySchema(vaultId);
  const [referentStatus,setReferentStatus]=useState<ReferentStatus>('unspecified');
  const [domainIds, setDomainIds] = useState<string[]>([]);
  const [subtypes, setSubtypes] = useState<string[]>([]);
  const [sourceFile,setSourceFile]=useState<File|null>(null),[sourceUrl,setSourceUrl]=useState(''),[sourceText,setSourceText]=useState('');
  const submitting=useRef(false);
  const [stagedSource,setStagedSource]=useState<SourceFile|null>(null),[fetchedSource,setFetchedSource]=useState<SourceFile|null>(null);
  const [containsMath,setContainsMath]=useState(false);
  const [pdfOptions,setPdfOptions]=useState<SourceIngestionOptions>(initialPdfIngestionOptions),[pdfReady,setPdfReady]=useState(true),[pdfCapabilitiesEnabled,setPdfCapabilitiesEnabled]=useState(false);
  const stagingKey=useRef(crypto.randomUUID());
  function changePdfOptions(options:SourceIngestionOptions){setPdfOptions(options);setStagedSource(null);stagingKey.current=crypto.randomUUID();}
  const [aliases, setAliases] = useState('');
  const [sourceMethod,setSourceMethod]=useState<''|'file'|'url'|'text'|'bibtex'>('');
  const isPdf=sourceMethod==='file'&&!!sourceFile&&/\.pdf$/i.test(sourceFile.name)||sourceMethod==='url'&&fetchedSource?.format==='pdf';
  const [nameEdited,setNameEdited]=useState(!!initial.name);
  let suggestedName=sourceMethod==='text'?'Pasted text':sourceFile?.name.slice(0,200)??'';
  if(sourceMethod==='url') {
    try {
      const url=new URL(sourceUrl);
      suggestedName=(decodeURIComponent(url.pathname.split('/').at(-1)??'')||url.hostname).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,220);
      if(!/\.(txt|md|pdf)$/i.test(suggestedName))suggestedName+='.txt';
      suggestedName=suggestedName.slice(0,200);
    }catch{suggestedName='';}
  }
  if(sourceMethod==='url'&&fetchedSource)suggestedName=fetchedSource.name.slice(0,200);
  const resolvedName=type==='source'&&!nameEdited?suggestedName:name;
  const sourceReady=sourceMethod==='file'?!!sourceFile:sourceMethod==='url'?!!sourceUrl.trim():sourceMethod==='text'?sourceText.length>0:false;
  function selectFile(file:File|null) {
    setStagedSource(null);setPdfOptions(options=>({...options,transmissionConsent:false}));stagingKey.current=crypto.randomUUID();setError('');setSourceFile(null);
    if(!file)return;
    if(!/\.(txt|md|pdf)$/i.test(file.name)){setError('Choose a TXT, MD, or PDF file.');return;}
    if(!file.size||file.size>maxSourceBytes){setError('Choose a nonempty file of 50 MB or smaller.');return;}
    setSourceFile(file);
  }
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if(submitting.current||busy)return;
    if(type==='source'&&isPdf&&!pdfReady)return;
    if(type==='source'&&sourceMethod==='text'){try{validatePastedSourceText(sourceText);}catch(reason){setError(reason instanceof Error?reason.message:'Enter valid source text.');return;}}
    if(!allowedTypes.includes(type)||(type==='source'?!sourceReady:!resolvedName.trim()))return;
    submitting.current=true;setBusy(true);setError('');
    try {
      let source=stagedSource;
      if(type==='source'&&sourceMethod==='url'&&!source){
        source=fetchedSource;
        if(!source){
          source=await request<SourceFile>('source-files/url/preview','POST',{url:sourceUrl.trim(),containsMath,stagingKey:stagingKey.current},vaultId);
          setFetchedSource(source);
          if(source.format==='pdf'){setPdfOptions(options=>({...options,transmissionConsent:false}));return;}
        }
        if(source.format==='pdf'&&(pdfCapabilitiesEnabled||pdfOptions.route!=='local'))source=await request<SourceFile>(`source-files/${encodeURIComponent(source.id)}/ingestion`,'POST',{options:{...pdfOptions,containsMath}},vaultId);
        setStagedSource(source);
      }
      if(type==='source'&&!source) {
        source=sourceMethod==='file'
          ? await uploadSourceFile(vaultId,sourceFile!,undefined,containsMath,isPdf?{...pdfOptions,containsMath}:undefined,stagingKey.current)
          : sourceMethod==='text'
          ? await uploadSourceFile(vaultId,new File([sourceText],pastedSourceFilename(resolvedName),{type:'text/plain'}),undefined,containsMath)
          : await request<SourceFile>('source-files/url/preview','POST',{url:sourceUrl.trim(),containsMath,stagingKey:stagingKey.current},vaultId);
        setStagedSource(source);
      }
      await onSubmit({referentStatus,name:resolvedName.trim()||source?.name.slice(0,200)||'',aliases:type==='source'?[]:parseAliases(aliases),type,subtypes,...(type==='concept'?{domainIds}:{}),...(type==='source'&&source?{attachmentIds:[source.id]}:{})});
      onClose();
    }catch(error){setError(error instanceof Error?error.message:String(error));}
    finally { submitting.current=false;setBusy(false); }
  }
  function cancel() { if(submitting.current||busy)return; onClose(); requestAnimationFrame(()=>initial.onCancel?.()); }
  const namePlaceholder: Partial<Record<EntityType,string>> = {person:'e.g. Ursula K. Le Guin',place:'e.g. Kyoto',organization:'e.g. The Royal Society',event:'e.g. World Expo 2025',creativework:'e.g. The Left Hand of Darkness',thing:'e.g. Grilled alumahan',organism:'e.g. Ginkgo biloba',culture:'e.g. Japanese',concept:'e.g. Systems thinking',source:'e.g. Interview with Ursula K. Le Guin'};
  if(type==='source'&&sourceMethod==='bibtex')return <BibliographyImport vaultId={vaultId} single onClose={()=>setSourceMethod('')} onUpdated={async()=>{await initial.onBibliographyCreated?.();onClose();}}/>;
  return <Modal className="create-entity-dialog" onClose={cancel} initialFocus={initial.source ? undefined : 'input[name="entity-name"]'} titleId="create-dialog-title"><form onSubmit={submit} aria-busy={busy}>
    <ModalHeader titleId="create-dialog-title" leading={<Icon name={type} entity={{type,subtypes}}/>} closeDisabled={busy}>{initial.intent==='insert'?uiText("Create and insert"):initial.source ? uiText("New source") : uiText("New entity")}</ModalHeader><p className="modal-description">{initial.intent==='insert'?uiText("Add an entity and keep writing."):initial.source?uiText("Add a document to your Sources library."):uiText("Add to your knowledge library.")}</p>
    <div className="create-entity-fields">
      {!initial.source&&<label>{uiText("Entity type")}<Select aria-label={uiText("Entity type")} value={type} onChange={e => { setType(e.target.value as EntityType); setSubtypes([]); setDomainIds([]); setSourceFile(null); setSourceUrl(''); setStagedSource(null); setSourceMethod(''); setFetchedSource(null);setPdfOptions(options=>({...options,transmissionConsent:false}));setContainsMath(false); setError(''); }} disabled={busy}>{allowedTypes.map(t => <option key={t} value={t}>{uiText(entityLabels[t])}</option>)}</Select></label>}
      {type==='source'&&<label>{uiText("Add source from (required)")}<Select aria-label={uiText("Add source from")} required value={sourceMethod} onChange={event=>{setSourceMethod(event.target.value as 'file'|'url'|'text'|'bibtex');setSourceFile(null);setSourceUrl('');setStagedSource(null);setFetchedSource(null);setPdfOptions(options=>({...options,transmissionConsent:false}));stagingKey.current=crypto.randomUUID();setError('');}} disabled={busy}><option value="" disabled>{uiText("Choose file, URL, or pasted text")}</option><option value="file">{uiText("File")}</option><option value="url">{uiText("URL")}</option><option value="text">{uiText("Paste text")}</option>{initial.intent!=='insert'&&<option value="bibtex">Import from BibTeX</option>}</Select></label>}
      {type==='source'&&sourceMethod&&sourceMethod!=='bibtex'&&<section className="source-attachments">
        {sourceMethod==='file'
          ? <label key="file" className="source-upload">{uiText("Choose source file")}<input type="file" required accept=".txt,.md,.pdf" aria-label={uiText("Choose source file")} disabled={busy} onChange={event=>selectFile(event.target.files?.[0]??null)}/></label>
          : sourceMethod==='text'
          ? <label key="text" htmlFor="pasted-source-text">{uiText("Source text")}<textarea id="pasted-source-text" name="source-text" required rows={10} value={sourceText} aria-describedby="pasted-source-help" disabled={busy} onChange={event=>{setSourceText(event.target.value);setStagedSource(null);setError('');}} placeholder={uiText("Paste your source text here")}/><span id="pasted-source-help" className="source-math-help">{uiText("Plain text, up to 16 MB in UTF-8. Your text is uploaded as a TXT source without changing its content.")}</span></label>
          : <label key="url">{uiText("Source URL")}<input type="url" inputMode="url" required value={sourceUrl} onChange={event=>{setSourceUrl(event.target.value);setStagedSource(null);setFetchedSource(null);setPdfOptions(options=>({...options,transmissionConsent:false}));stagingKey.current=crypto.randomUUID();setError('');}} disabled={busy} placeholder={uiText("https://example.com/article")}/></label>}
        {sourceMethod==='url'&&fetchedSource?.format==='pdf'&&<p className="section-hint">{uiText('The fetched content is a PDF. Choose processing and authorize provider transmission before creating this source. The fetched PDF is retained while you choose options.')}</p>}
        {isPdf&&<SourcePdfProcessing vaultId={vaultId} value={pdfOptions} onChange={changePdfOptions} onReady={setPdfReady} onEnabled={setPdfCapabilitiesEnabled} disabled={busy}/>}
        <label className="source-math-option"><input type="checkbox" checked={containsMath} disabled={busy} onChange={event=>{setContainsMath(event.target.checked);setStagedSource(null);stagingKey.current=crypto.randomUUID();}} aria-describedby="source-math-help"/><span>{uiText("This document contains substantial mathematical notation")}</span></label>
        <p id="source-math-help" className="source-math-help">{uiText("Prepare mathematical notation for rendering during source processing. Leave unchecked for ordinary prose.")}</p>
        <SourcePolicy method={sourceMethod} ingestionRoute={isPdf?pdfOptions.route:undefined}/>
      </section>}

      <label>{uiText("Name")}<input name="entity-name" autoFocus={type!=='source'} required={type!=='source'} maxLength={200} value={resolvedName} onChange={e => {setName(e.target.value);setNameEdited(true);}} disabled={busy} placeholder={type==='source'?uiText(sourceMethod==='text'?"Pasted text":"Uses the source filename"):namePlaceholder[type] ?? uiText("Entity name")} autoComplete="off"/></label>
      <SubtypePicker type={type} value={subtypes} subtypes={schema.subtypes} onChange={setSubtypes} disabled={busy}/>
      <ReferentStatusPicker value={referentStatus} onChange={setReferentStatus} disabled={busy}/>
      {type==='concept'&&<DomainPicker value={domainIds} onChange={setDomainIds} disabled={busy}/>}
      {type!=='source'&&<AliasInput value={aliases} onChange={setAliases} disabled={busy}/>}
      {schemaError && <p className="dialog-error" role="alert">{schemaError}</p>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
    </div>
    <footer className="dialog-actions create-entity-actions"><button type="button" className="button" onClick={cancel} disabled={busy}>{uiText("Cancel")}</button><button className="button primary" disabled={busy||(type==='source'?!sourceReady||isPdf&&!pdfReady:!resolvedName.trim())}>{busy?uiText(sourceMethod==='url'&&!fetchedSource?"Fetching…":"Creating…"):type==='source'&&sourceMethod==='url'&&!fetchedSource?uiText("Fetch source"):initial.intent==='insert'?uiText("Create and insert"):initial.source?uiText("Create source"):uiText("Create entity")}</button></footer>
  </form></Modal>;
}
