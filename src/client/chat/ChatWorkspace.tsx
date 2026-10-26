import {createPortal} from 'react-dom';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Entity,Folder,PageSummary} from '../../shared/domain';
import type {ChatEvidence,ChatMention,ChatMessage,ChatScope,ChatThread,ChatResult} from '../../shared/chat';
import {randomUUID} from '../../shared/uuid';
import {chatAPI,streamChat} from './api';
import {readChatSession,writeChatSession,clearChatSession,readChatDrafts,writeChatDrafts,type ChatSession} from './chat-session';
import {ChatTitle} from './ChatTitle';
import {useDefaultPersona} from '../components/PersonaSelect';
import {MenoPicker} from './MenoPicker';
import {MenoAvatar} from './MenoAvatar';
import {ChatInbox} from './ChatInbox';
import {ChatContextPicker,chatContextChoices,chatFolderPath,type ChatContextChoice} from './ChatContextPicker';
import {Modal,ModalHeader} from '../components/Modal';
import {Icon} from '../components/Icon';
import {useMobileViewport} from '../components/WorkspaceNavigation';
interface Props {vaultId:string;vaultName:string;initialScope:ChatScope;restoreSession?:boolean;entities:Entity[];pages:PageSummary[];folders?:Folder[];visible:boolean;onClose:()=>void;onOpenAISettings?:()=>void;onOpenEvidence:(evidence:ChatEvidence,trigger:HTMLElement)=>void}
const kindLabels={source:'Imported source · original extraction',own_note:'Your note',entity_fact:'Recorded entity fact',entity_overview:'Entity overview'};
const evidenceLabel=(evidence:ChatEvidence)=>evidence.kind==='own_note'&&evidence.origin==='ai_generated'?'AI-generated secondary note':evidence.kind==='own_note'&&evidence.origin==='mixed'?'Note with AI-generated text':kindLabels[evidence.kind];
const minimumTypingTime=300;
interface FailedTurn {question:string;mentions:ChatMention[];scope:ChatScope;deep:boolean;temporary:boolean;threadId?:string;regenerateMessageId?:string;retryMessageId?:string;userId:string}
function waitForChatBeat(milliseconds:number,signal:AbortSignal):Promise<void> {
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new DOMException('Stopped','AbortError'));return;}
  const abort=()=>{clearTimeout(timer);reject(new DOMException('Stopped','AbortError'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},Math.max(0,milliseconds));
  signal.addEventListener('abort',abort,{once:true});
 });
}
export function ChatWorkspace({vaultId,initialScope,restoreSession=false,entities,pages,folders=[],visible,onClose,onOpenAISettings,onOpenEvidence}:Props) {
 const mobile=useMobileViewport();
 const personaId=useDefaultPersona();
 const [resume]=useState(()=>restoreSession?readChatSession(vaultId):null);
 const pendingScroll=useRef(resume?{top:resume.scrollTop,bottom:resume.followBottom}:null);
 const closed=useRef(false);
 const drafts=useRef(readChatDrafts(vaultId));
 const [failedTurn,setFailedTurn]=useState<FailedTurn|null>(null);
 const [confirmDelete,setConfirmDelete]=useState<string|null>(null);
 const [pendingScope,setPendingScope]=useState<{scope:ChatScope;draft:string;mentions:ChatMention[]}|null>(null);
 const [inboxCollapsed,setInboxCollapsed]=useState(resume?.inboxCollapsed??false);
 const [toolbarHost]=useState(()=>document.getElementById('chat-toolbar'));
 const [deletingThread,setDeletingThread]=useState<string|null>(null);
 const optionsMenu=useRef<HTMLDetailsElement>(null);
 const [atBottom,setAtBottom]=useState(resume?.followBottom??true);
 const [scope,setScope]=useState(resume?.scope??initialScope),[messages,setMessages]=useState<ChatMessage[]>([]),[question,setQuestion]=useState(resume?.draft??''),[mentions,setMentions]=useState<ChatMention[]>(resume?.mentions??[]),[threads,setThreads]=useState<ChatThread[]>([]),[threadId,setThreadId]=useState<string|undefined>(resume?.threadId),[temporary,setTemporary]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[usage,setUsage]=useState<ChatResult['usage']>(),[deep,setDeep]=useState(resume?.deep??false),[selected,setSelected]=useState<ChatEvidence|null>(null),[mentionIndex,setMentionIndex]=useState(0),[loadingThread,setLoadingThread]=useState(!!resume?.threadId),[verifying,setVerifying]=useState(false),[editingTitle,setEditingTitle]=useState(false),[title,setTitle]=useState('');
 const [animatedTitle,setAnimatedTitle]=useState<{id:string;title:string}|null>(null);
 const [titleDraft,setTitleDraft]=useState(''),[savingTitle,setSavingTitle]=useState(false);
 const titleTrigger=useRef<HTMLButtonElement>(null);
 function startRename(){if(!threadId||busy||loadingThread)return;setTitleDraft(title);setEditingTitle(true);}
 const welcome=useRef<HTMLDivElement>(null),contact=useRef<HTMLDivElement>(null),menoOrigin=useRef<DOMRect|null>(null);
 const chatMain=useRef<HTMLDivElement>(null),chatToolbar=useRef<HTMLDivElement>(null);
 const showWelcome=!messages.length&&!loadingThread&&!busy;
 useLayoutEffect(()=>{
  const main=chatMain.current,toolbar=chatToolbar.current;
  if(!visible||!main||!toolbar)return;
  const align=()=>{
   const conversation=main.getBoundingClientRect(),header=toolbar.getBoundingClientRect();
   if(conversation.width&&header.width)toolbar.style.setProperty('--chat-contact-center',`${conversation.left+conversation.width/2-header.left}px`);
  };
  align();
  const observer=typeof window.ResizeObserver==='function'?new window.ResizeObserver(align):null;
  observer?.observe(main);observer?.observe(toolbar);
  window.addEventListener('resize',align);
  return()=>{observer?.disconnect();window.removeEventListener('resize',align);};
 },[visible,showWelcome,toolbarHost]);
 useLayoutEffect(()=>{
  const origin=menoOrigin.current;
  if(showWelcome||!visible||!origin)return;
  menoOrigin.current=null;
  const avatar=contact.current?.querySelector<HTMLButtonElement>('.meno-avatar');
  if(!avatar||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const destination=avatar.getBoundingClientRect();
  if(!destination.width)return;
  const x=origin.left+origin.width/2-destination.left-destination.width/2,y=origin.top+origin.height/2-destination.top-destination.height/2;
  const animation=avatar.animate?.([{transform:`translate(${x}px, ${y}px) scale(${origin.width/destination.width})`},{transform:'translate(0, 0) scale(1)'}],{duration:650,easing:'cubic-bezier(.22,1,.36,1)'});
  return()=>animation?.cancel();
 },[showWelcome,visible]);
 const [receivedId,setReceivedId]=useState<string|null>(null),[typingLeaving,setTypingLeaving]=useState(false),[evidenceCount,setEvidenceCount]=useState<number|null>(null);
 const typingStatus=evidenceCount===null?(deep?'Searching your sources more thoroughly…':'Searching your sources…'):evidenceCount?`Preparing an answer from ${evidenceCount} ${evidenceCount===1?'reference':'references'}…`:'Preparing your answer…';
 const [historyOpen,setHistoryOpen]=useState(false),[historyLoading,setHistoryLoading]=useState(true),[historyError,setHistoryError]=useState('');
 const followOutput=useRef(resume?.followBottom??true);
 const historyToggle=useRef<HTMLButtonElement>(null);
 const composer=useRef<HTMLTextAreaElement>(null),evidenceClose=useRef<HTMLButtonElement>(null),citationTrigger=useRef<HTMLElement|null>(null),request=useRef<{controller:AbortController;id:string}|null>(null),alive=useRef(true),operation=useRef(0),historyController=useRef<AbortController|null>(null),verificationController=useRef<AbortController|null>(null),log=useRef<HTMLDivElement>(null);
 useEffect(()=>{const dismiss=(event:PointerEvent)=>{if(optionsMenu.current&&!optionsMenu.current.contains(event.target as Node))optionsMenu.current.open=false;};document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);},[]);
 const scopeTitle=scope.kind==='vault'?'':scope.kind==='folder'?`Folder · ${chatFolderPath(folders,scope.id)||scope.id}`:scope.kind==='page'?`Page · ${pages.find(page=>page.id===scope.id)?.title||scope.id}`:`${scope.kind==='source'?'Source':'Entity'} · ${entities.find(entity=>entity.id===scope.id)?.name||scope.id}`;
 const at=/@([^@\n]*)$/.exec(question),candidates=at&&!busy&&!loadingThread?chatContextChoices(vaultId,at[1],entities,pages,folders,mentions):[];
 const refresh=async()=>{setHistoryLoading(true);try{const result=await chatAPI.list(vaultId);if(alive.current){setThreads(result);setHistoryError('');}}catch(err){if(alive.current)setHistoryError(err instanceof Error?err.message:'Could not load conversations.');}finally{if(alive.current)setHistoryLoading(false);}};
 useEffect(()=>{alive.current=true;const controller=new AbortController();void chatAPI.list(vaultId,controller.signal).then(value=>{if(!controller.signal.aborted){setThreads(value);setHistoryError('');}}).catch(err=>{if(!controller.signal.aborted)setHistoryError(err instanceof Error?err.message:'Could not load conversations.');}).finally(()=>{if(!controller.signal.aborted)setHistoryLoading(false);});return()=>{alive.current=false;operation.current++;controller.abort();historyController.current?.abort();verificationController.current?.abort();const active=request.current;if(active){active.controller.abort();void chatAPI.cancel(vaultId,active.id).catch(()=>{});}};},[vaultId]);
 useEffect(()=>{if(visible)composer.current?.focus();else {setHistoryOpen(false);verificationController.current?.abort();setVerifying(false);setSelected(null);if(temporary){operation.current++;const pending=request.current;request.current=null;pending?.controller.abort();if(pending)void chatAPI.cancel(vaultId,pending.id).catch(()=>{});setBusy(false);setTypingLeaving(false);setReceivedId(null);setMessages([]);setQuestion('');setMentions([]);setThreadId(undefined);setNotice('');setError('');setFailedTurn(null);}const active=request.current;if(active){active.controller.abort();void chatAPI.cancel(vaultId,active.id).catch(()=>{});}}},[visible,vaultId,temporary]);
 useEffect(()=>{if(!pendingScroll.current&&followOutput.current)log.current?.scrollTo?.({top:log.current.scrollHeight,behavior:'instant'});},[messages,busy]);
 useEffect(()=>{if(!mobile)setHistoryOpen(false);},[mobile]);
 useLayoutEffect(()=>{const element=composer.current;if(element){element.style.height='auto';element.style.height=Math.min(160,Math.max(44,element.scrollHeight))+'px';}},[question]);
 useLayoutEffect(()=>{
  if(loadingThread||!pendingScroll.current||!log.current)return;
  const position=pendingScroll.current;pendingScroll.current=null;
  log.current.scrollTop=position.bottom?log.current.scrollHeight:position.top;
  followOutput.current=position.bottom;
 },[loadingThread,messages]);
 const draftKey=threadId??'new:'+JSON.stringify(scope);
 function saveDraft() {
  if(temporary||loadingThread)return;
  drafts.current[draftKey]={draft:question,mentions,deep};
  writeChatDrafts(vaultId,drafts.current);
 }
 function remember() {
  saveDraft();
  if(closed.current||loadingThread)return;
  if(temporary){clearChatSession(vaultId);return;}
  writeChatSession(vaultId,{open:visible,inboxCollapsed,scope,threadId,draft:question,mentions,deep,scrollTop:pendingScroll.current?.top??log.current?.scrollTop??0,followBottom:followOutput.current,pending:busy});
 }
 useEffect(()=>{remember();window.addEventListener('pagehide',remember);return()=>window.removeEventListener('pagehide',remember);},[visible,scope,threadId,question,mentions,deep,temporary,busy,loadingThread,messages,inboxCollapsed]);
 useEffect(()=>{if(resume?.threadId)void openThread(resume.threadId,resume);},[]);

 useEffect(()=>{if(selected)evidenceClose.current?.focus();},[selected?.id]);
 useEffect(()=>{if(!selected||!mobile)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[!!selected,mobile]);
 useEffect(()=>{setMentionIndex(0);},[at?.[1]]);
 const dismissEvidence=()=>{verificationController.current?.abort();setVerifying(false);setSelected(null);const trigger=citationTrigger.current;requestAnimationFrame(()=>{if(alive.current&&trigger?.isConnected)trigger.focus({preventScroll:true});});};
 const inspectEvidence=async(evidence:ChatEvidence,trigger:HTMLElement)=>{if(!trigger.closest('.chat-evidence'))citationTrigger.current=trigger;verificationController.current?.abort();const controller=new AbortController();verificationController.current=controller;setVerifying(true);setError('');try{const [validated]=await chatAPI.verify(vaultId,[evidence],controller.signal);if(!alive.current||controller.signal.aborted)return;if(!validated)throw new Error('This evidence could not be verified.');setSelected(validated);setMessages(current=>current.map(message=>({...message,evidence:message.evidence?.map(item=>item.id===validated.id&&item.fingerprint===validated.fingerprint?validated:item)})));}catch(err){if(alive.current&&!controller.signal.aborted){setSelected(null);setError(err instanceof Error?err.message:'Could not verify this reference.');}}finally{if(alive.current&&!controller.signal.aborted)setVerifying(false);}};
 const openOriginal=async(evidence:ChatEvidence,trigger:HTMLElement)=>{verificationController.current?.abort();const controller=new AbortController();verificationController.current=controller;setVerifying(true);try{const [validated]=await chatAPI.verify(vaultId,[evidence],controller.signal);if(!alive.current||controller.signal.aborted)return;if(!validated)throw new Error('This evidence could not be verified.');setSelected(validated);if(validated.status==='current'){setSelected(null);onOpenEvidence(validated,citationTrigger.current??trigger);}}catch(err){if(alive.current&&!controller.signal.aborted)setError(err instanceof Error?err.message:'Could not verify this reference.');}finally{if(alive.current&&!controller.signal.aborted)setVerifying(false);}};
 const stop=()=>{const active=request.current;if(!active)return;active.controller.abort();verificationController.current?.abort();setVerifying(false);setSelected(null);void chatAPI.cancel(vaultId,active.id).catch(()=>{});setNotice('Stopped. Provider work already sent may still be billed.');};
 const newChat=(temp=temporary)=>{saveDraft();setFailedTurn(null);setAnimatedTitle(null);setReceivedId(null);pendingScroll.current=null;followOutput.current=true;setAtBottom(true);setHistoryOpen(false);setHistoryError('');verificationController.current?.abort();setVerifying(false);operation.current++;historyController.current?.abort();setLoadingThread(false);setThreadId(undefined);setMessages([]);setQuestion('');setMentions([]);setSelected(null);setTemporary(temp);setError('');setNotice('');setUsage(undefined);setTitle('');setEditingTitle(false);requestAnimationFrame(()=>{if(alive.current)composer.current?.focus();});};
 const applyScope=(next:ChatScope,draft:string,resolved:ChatMention[])=>{
  newChat();setQuestion(draft);setMentions(resolved.filter(mention=>entities.some(entity=>entity.id===mention.id&&entity.vault_id===vaultId&&!entity.inactive&&!entity.archived_at)));setScope(next);
  setNotice(next.kind==='vault'?'Started a new conversation using the whole vault.':'Started a new conversation limited to the selected context.');
 };
 const changeScope=(next:ChatScope,draft=question)=>{
  if(busy||loadingThread||JSON.stringify(next)===JSON.stringify(scope))return;
  if(threadId||messages.length){setPendingScope({scope:next,draft,mentions:[...mentions]});return;}
  applyScope(next,draft,mentions);
 };
 const openThread=async(id:string,restore?:ChatSession)=>{saveDraft();setFailedTurn(null);setAnimatedTitle(null);setReceivedId(null);verificationController.current?.abort();setVerifying(false);const version=++operation.current;historyController.current?.abort();const controller=new AbortController();historyController.current=controller;setLoadingThread(true);setError('');setHistoryError('');try {const thread=await chatAPI.get(vaultId,id,controller.signal);if(!alive.current||version!==operation.current)return;followOutput.current=restore?.followBottom??true;setAtBottom(followOutput.current);pendingScroll.current=restore?{top:restore.scrollTop,bottom:restore.followBottom}:null;setHistoryOpen(false);requestAnimationFrame(()=>{if(alive.current&&version===operation.current)composer.current?.focus();});setThreadId(thread.id);setScope(thread.scope);setMessages(thread.messages);setTemporary(false);setSelected(null);const savedDraft=drafts.current[id];setQuestion(restore?.draft??savedDraft?.draft??'');setMentions(restore?.mentions??savedDraft?.mentions??[]);setDeep(restore?.deep??savedDraft?.deep??false);setTitle(thread.title);setEditingTitle(false);const last=thread.messages.at(-1),previous=thread.messages.at(-2);if(last?.role==='assistant'&&['failed','interrupted'].includes(last.status??'')&&previous?.role==='user')setFailedTurn({question:previous.text,mentions:previous.mentions??[],scope:thread.scope,deep:previous.searchDepth==='deep',temporary:false,threadId:thread.id,retryMessageId:last.id,userId:previous.id});setNotice(restore?.pending&&thread.messages.at(-1)?.role==='user'?'The previous answer was interrupted by refresh. You can send a new question.':'');setUsage(undefined);}catch(err){if(alive.current&&!controller.signal.aborted){setHistoryError(err instanceof Error?err.message:'Could not open this conversation.');if(restore){setThreadId(undefined);pendingScroll.current=null;}}}finally{if(alive.current&&version===operation.current)setLoadingThread(false);}};
 const submit=async(retry?:ChatMessage,failed?:FailedTurn)=>{
 const retryIndex=retry?messages.findIndex(message=>message.id===retry.id):-1;
 const previousUser=retry?messages.slice(0,retryIndex).filter(message=>message.role==='user').at(-1):undefined;
 const text=failed?.question??(retry?previousUser?.text??'':question.trim());if(!text||request.current||busy||loadingThread)return;
 const turnScope=failed?.scope??scope,turnDeep=failed?.deep??deep,turnTemporary=failed?.temporary??temporary;
 let turnThread=failed?.threadId??threadId;
 const replacing=failed?.regenerateMessageId??retry?.id;
 let failedMessage=failed?.retryMessageId;
 const originalUserId=failed?.userId??randomUUID();
 if(!retry&&!failed&&at){setError('Choose a context or reference from the @ list, or remove the unresolved @ mention.');return;}
 if(showWelcome)menoOrigin.current=welcome.current?.querySelector('.meno-avatar')?.getBoundingClientRect()??null;
 followOutput.current=true;setAtBottom(true);const controller=new AbortController(),id=randomUUID(),version=++operation.current;request.current={controller,id};setBusy(true);setFailedTurn(null);setEvidenceCount(null);setTypingLeaving(false);setReceivedId(null);setUsage(undefined);setError('');setNotice('');setSelected(null);
 const typingStarted=Date.now();let completed:ChatResult|undefined;
 const turnMentions=failed?.mentions??(retry?previousUser?.mentions??[]:mentions);
 const user:ChatMessage={id:originalUserId,role:'user',text,createdAt:new Date().toISOString(),mentions:turnMentions};if(!retry&&!failed){setMessages(current=>[...current,user]);setQuestion('');setMentions([]);}
 try {
 // Resolve the persisted failure marker before retrying, so the server replaces
 // that marker without dispatching a second copy of the original question.
 if(failed&&turnThread&&!replacing&&!failedMessage){
  const saved=await chatAPI.get(vaultId,turnThread,controller.signal);
  const last=saved.messages.at(-1),user=saved.messages.at(-2);
  if(last?.role==='assistant'&&['failed','interrupted'].includes(last.status??'')&&user?.role==='user'&&user.text===text)failedMessage=last.id;
  else if(last?.role==='assistant'&&last.status!=='failed'&&last.status!=='interrupted'&&user?.text===text){setMessages(saved.messages);setNotice('The previous answer completed.');return;}
  else throw new Error('The saved conversation changed. Reopen it before retrying.');
 }
 await streamChat(vaultId,{question:text,scope:turnScope,mentions:turnMentions,threadId:turnThread,...(replacing&&turnThread?{regenerateMessageId:replacing}:{}),...(failedMessage&&turnThread?{retryMessageId:failedMessage}:{}),temporary:turnTemporary,deep:turnDeep,requestId:id,...(turnTemporary?{contextMentions:messages.slice(-200).filter(message=>message.role==='user'&&message.mentions?.length).at(-1)?.mentions?.slice(0,8)??[]}:{}),previousQuestions:(retry?messages.slice(0,retryIndex).filter(message=>message.role==='user').slice(0,-1):failed?messages.filter(message=>message.role==='user'&&message.id!==originalUserId):messages.filter(message=>message.role==='user')).slice(-3).map(message=>message.text)},controller.signal,event=>{
 if(!alive.current||version!==operation.current||controller.signal.aborted)return;
 if(event.type==='thread'){turnThread=event.threadId;setThreadId(event.threadId);if(!threadId){setTitle('New chat');const now=new Date().toISOString();setThreads(current=>current.some(item=>item.id===event.threadId)?current:[{id:event.threadId,vaultId,title:'New chat',scope,createdAt:now,updatedAt:now,messages:[]},...current]);}}
 if(event.type==='evidence'){setEvidenceCount(event.evidence.length);if(event.threadId){setThreadId(event.threadId);if(!threadId)setTitle('New chat');}}
 if(event.type==='claim')setEvidenceCount(current=>current??0);
 if(event.type==='answer'){setEvidenceCount(event.result.diagnostics.evidenceCount);completed=event.result;}
 });
 if(completed){
  const result=completed;
  await waitForChatBeat(minimumTypingTime-(Date.now()-typingStarted),controller.signal);
  if(!alive.current||version!==operation.current||controller.signal.aborted)return;
  setTypingLeaving(true);
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)await waitForChatBeat(140,controller.signal);
  if(!alive.current||version!==operation.current||controller.signal.aborted)return;
  setReceivedId(result.message.id);setUsage(result.usage);setMessages(current=>replacing?current.map(message=>message.id===replacing?result.message:message):[...current.filter(message=>message.id!==failedMessage),result.message]);if(result.threadId){setThreadId(result.threadId);const next=result.title??(!threadId?text.slice(0,72):title);setTitle(next);if(result.titleUpdated){setAnimatedTitle({id:result.threadId,title:next});setThreads(current=>current.map(item=>item.id===result.threadId?{...item,title:next,updatedAt:result.message.createdAt||new Date().toISOString()}:item));}}setNotice(`Answer complete · ${result.diagnostics.evidenceCount} evidence items.`);
 }
 if(!temporary&&alive.current&&version===operation.current)await refresh();
 }catch(err){if(alive.current&&version===operation.current){verificationController.current?.abort();setVerifying(false);setSelected(null);if(controller.signal.aborted)setNotice('Stopped. Unfinished answer discarded. Provider work already sent may still be billed.');else setError(err instanceof Error?err.message:'Chat could not answer.');setFailedTurn({question:text,mentions:turnMentions,scope:turnScope,deep:turnDeep,temporary:turnTemporary,threadId:turnThread,regenerateMessageId:replacing,retryMessageId:failedMessage,userId:originalUserId});}}
 finally{if(alive.current&&version===operation.current){setBusy(false);setTypingLeaving(false);request.current=null;composer.current?.focus();}}
 };
 const inbox=<ChatInbox active={visible} animatedTitle={animatedTitle} threads={threads} selectedId={threadId} disabled={busy||loadingThread||!!deletingThread} loading={historyLoading} error={historyError} onHide={()=>{if(mobile)closeHistory();else{setInboxCollapsed(true);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('[aria-label="Show inbox"]')?.focus());}}} onDelete={id=>setConfirmDelete(id)} onNew={()=>newChat()} onSelect={id=>void openThread(id)} onRetry={()=>void refresh()}/>;
 const closeHistory=()=>{setHistoryOpen(false);requestAnimationFrame(()=>historyToggle.current?.focus());};

 const chooseMention=(choice:ChatContextChoice)=>{
  if(busy||loadingThread)return;
  if(choice.kind==='entity'){
   const entity=choice.entity;setMentions(current=>[...current,{id:entity.id,name:entity.name}]);setQuestion(current=>current.replace(/@([^@\n]*)$/,'')+entity.name+' ');
  }else{
   const draft=question.replace(/@([^@\n]*)$/,'');changeScope(choice.scope,draft);
  }
  composer.current?.focus();
 };
 const promptContext=()=>{setQuestion(current=>/@([^@\n]*)$/.test(current)?current:current+(current&&!/\s$/.test(current)?' ':'')+'@');composer.current?.focus();};
 const rename=async()=>{
  const next=titleDraft.trim(),id=threadId,version=operation.current;if(!id||!next||savingTitle)return;
  setSavingTitle(true);setError('');
  try{const updated=await chatAPI.rename(vaultId,id,next);if(alive.current&&version===operation.current){setTitle(updated.title);setAnimatedTitle(null);setReceivedId(null);setEditingTitle(false);await refresh();requestAnimationFrame(()=>titleTrigger.current?.focus());}}
  catch(err){if(alive.current&&version===operation.current)setError(err instanceof Error?err.message:'Could not rename conversation.');}
  finally{if(alive.current)setSavingTitle(false);}
 };
 async function removeThread(id:string) {
  if(deletingThread||busy)return;setConfirmDelete(null);const version=operation.current;setDeletingThread(id);setHistoryError('');
  try{await chatAPI.remove(vaultId,id);if(alive.current){if(id===threadId&&version===operation.current)newChat(false);delete drafts.current[id];writeChatDrafts(vaultId,drafts.current);await refresh();}}
  catch(err){if(alive.current)setHistoryError(err instanceof Error?err.message:'Could not delete conversation.');}
  finally{if(alive.current)setDeletingThread(null);}
 }
 const remove=()=>{if(threadId)setConfirmDelete(threadId);};
 const toolbar=<div ref={chatToolbar} className="chat-heading chat-toolbar" inert={mobile&&(!!selected||historyOpen)}><div className="chat-toolbar-controls">{mobile?<button ref={historyToggle} type="button" className="chat-icon" aria-label="Show conversations" aria-haspopup="dialog" aria-expanded={historyOpen} onClick={()=>setHistoryOpen(true)}><Icon name="panel-show"/></button>:<button type="button" className="chat-icon" aria-label={inboxCollapsed?'Show inbox':'Hide inbox'} title={inboxCollapsed?'Show inbox':'Hide inbox'} aria-controls="chat-history-pane" aria-expanded={!inboxCollapsed} onClick={()=>setInboxCollapsed(current=>!current)}><Icon name={inboxCollapsed?'panel-show':'panel-hide'}/></button>}<button type="button" className="chat-icon" disabled={busy||loadingThread} aria-label="New conversation" title="New conversation" onClick={()=>newChat()}><Icon name="compose"/></button></div><div className="chat-heading-title">{!showWelcome&&<div ref={contact} className="chat-contact"><MenoAvatar active={busy} personaId={personaId}/><div className="chat-contact-identity"><span className="chat-contact-name">Meno</span><MenoPicker personaId={personaId} disabled={busy} onOpenAISettings={onOpenAISettings}/></div></div>}{editingTitle?<form className="chat-rename" onSubmit={event=>{event.preventDefault();void rename();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setEditingTitle(false);requestAnimationFrame(()=>titleTrigger.current?.focus());}}}><input aria-label="Conversation title" value={titleDraft} onChange={event=>setTitleDraft(event.target.value)} maxLength={160} disabled={savingTitle} autoFocus onFocus={event=>event.currentTarget.select()}/><button className="chat-icon" type="submit" aria-label="Save title" title="Save title" disabled={savingTitle||!titleDraft.trim()}><Icon name="check"/></button><button className="chat-icon" type="button" aria-label="Cancel rename" disabled={savingTitle} onClick={()=>{setEditingTitle(false);requestAnimationFrame(()=>titleTrigger.current?.focus());}}><Icon name="close"/></button></form>:<h1><button ref={titleTrigger} type="button" className="chat-title-button" aria-label="Rename conversation" title={threadId?title+' · Click to rename':undefined} disabled={!threadId||busy||loadingThread} onClick={startRename}><ChatTitle title={threadId?title||'Conversation':temporary?'Temporary chat':'New chat'} animate={!!animatedTitle&&animatedTitle.id===threadId&&animatedTitle.title===title}/>{threadId&&<Icon name="edit"/>}</button></h1>}</div><div className="chat-heading-actions"><details ref={optionsMenu} className="chat-options" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}><summary aria-label="Conversation options" title="Conversation options"><Icon name="more"/></summary><div className="chat-options-menu" role="group" aria-label="Conversation options">{onOpenAISettings&&<button type="button" onClick={()=>{if(optionsMenu.current)optionsMenu.current.open=false;onOpenAISettings();}}><Icon name="settings"/>Persona &amp; AI settings</button>}{threadId&&<><button type="button" disabled={busy||loadingThread} aria-label="Rename in menu" onClick={()=>{if(optionsMenu.current)optionsMenu.current.open=false;startRename();}}><Icon name="edit"/>Rename</button><button type="button" disabled={busy||loadingThread} aria-label="Delete conversation" onClick={()=>{if(optionsMenu.current)optionsMenu.current.open=false;void remove();}}><Icon name="trash"/>Delete conversation</button></>}<label className="chat-check"><input type="checkbox" checked={temporary} disabled={busy||loadingThread||messages.length>0} onChange={event=>{if(optionsMenu.current)optionsMenu.current.open=false;newChat(event.target.checked);}}/>Temporary chat</label></div></details><button type="button" className="chat-icon" aria-label="Close Chat" onClick={()=>{closed.current=true;clearChatSession(vaultId);stop();onClose();}}><Icon name="close"/></button></div></div>;
 return <section className={'chat-workspace'+(selected?' has-evidence':'')+(inboxCollapsed?' is-history-collapsed':'')} aria-label="Chat workspace" hidden={!visible}>
 {confirmDelete&&<Modal titleId="chat-delete-title" onClose={()=>setConfirmDelete(null)} initialFocus="[data-cancel-delete]"><ModalHeader titleId="chat-delete-title">Delete conversation?</ModalHeader><p>This permanently deletes this conversation and its saved evidence references.</p><button type="button" className="button" data-cancel-delete onClick={()=>setConfirmDelete(null)}>Cancel</button><button type="button" className="button" onClick={()=>void removeThread(confirmDelete)}>Confirm delete</button></Modal>}
 {pendingScope&&<Modal titleId="chat-scope-title" onClose={()=>setPendingScope(null)} initialFocus="[data-cancel-scope]"><ModalHeader titleId="chat-scope-title">Start a new conversation?</ModalHeader><p>Changing where Meno searches starts a new conversation. Your question and available entity mentions will carry over. The current conversation stays in history.</p><button type="button" className="button" data-cancel-scope onClick={()=>setPendingScope(null)}>Keep current scope</button><button type="button" className="button" onClick={()=>{const next=pendingScope;setPendingScope(null);applyScope(next.scope,next.draft,next.mentions);}}>Start new conversation</button></Modal>}
 {visible&&toolbarHost&&createPortal(toolbar,toolbarHost)}
 {!mobile&&<aside id="chat-history-pane" className="chat-history-pane" aria-label="Chat inbox" hidden={inboxCollapsed}>{inbox}</aside>}
 {mobile&&historyOpen&&<Modal className="chat-history-dialog" titleId="chat-history-title" onClose={closeHistory} dismissOnBackdrop initialFocus="input[type=search]"><ModalHeader titleId="chat-history-title" closeLabel="Close conversations">Conversations</ModalHeader>{inbox}</Modal>}
 <div ref={chatMain} className="chat-main" inert={mobile&&(!!selected||historyOpen)}>
 {!toolbarHost&&toolbar}


 {temporary&&<p className="chat-muted">Temporary chat disappears when you close it. It is never saved to history.</p>}
 <div ref={log} className="chat-messages" onScroll={event=>{const element=event.currentTarget;followOutput.current=element.scrollHeight-element.scrollTop-element.clientHeight<80;setAtBottom(followOutput.current);remember();}} aria-label="Conversation" aria-busy={busy||loadingThread}>
 {showWelcome&&<div ref={welcome} className="chat-empty"><MenoAvatar personaId={personaId}/><h2>Hi, I’m Meno.</h2><p className="chat-empty-prompt">What would you like to understand?</p><p>Find a passage, compare arguments, or explore recorded connections. Answers draw from the selected material, with references you can inspect.</p></div>}
 {messages.map(message=><article className={'chat-message is-'+message.role+(message.id===receivedId?' is-arriving':'')} key={message.id}><h2>{message.role==='user'?'You':'Meno'}</h2><div className="chat-message-body">{message.claims?.length?message.claims.map((claim,index)=><p className="chat-claim" key={index}><span className={'chat-attribution'+(claim.attribution==='supported'?' sr-only':'')}>{claim.attribution==='inferred'?'Interpretation':claim.attribution==='unestablished'?'Not established':'Supported by selected evidence'}</span>{claim.text}{claim.citationIds.map(citation=>{const evidence=message.evidence?.find(item=>item.id===citation);return evidence?<button type="button" className="chat-citation" key={citation} aria-label={`Inspect reference ${citation}: ${evidence.title}${evidence.status!=='current'?' · '+evidence.status:''}`} onClick={event=>void inspectEvidence(evidence,event.currentTarget)}>{citation}{evidence.status!=='current'?' · '+evidence.status:''}</button>:null;})}</p>):<p className="chat-prose">{message.text}</p>}</div>{message.role==='assistant'&&<button type="button" className="chat-copy" aria-label="Copy answer" onClick={()=>{void navigator.clipboard.writeText(message.claims?.map(claim=>claim.text+(claim.citationIds.length?' ['+claim.citationIds.join(', ')+']':'')).join('\n\n')||message.text).then(()=>setNotice('Answer copied. References remain available in Chat.')).catch(()=>setError('Could not copy. Select the answer text to copy it.'));}} title="Copy answer"><Icon name="copy"/></button>}{message.role==='assistant'&&message.id===messages.at(-1)?.id&&message.status!=='failed'&&message.status!=='interrupted'&&<button type="button" className="chat-regenerate" aria-label="Regenerate answer" title="Regenerate answer" disabled={busy||loadingThread} onClick={()=>void submit(message)}><Icon name="refresh"/></button>}{message.role==='assistant'&&message.evidence?.length?<button className="chat-references" type="button" onClick={event=>void inspectEvidence(message.evidence![0],event.currentTarget)}>{message.evidence.length} references</button>:null}</article>)}
 {verifying&&<p role="status">Checking the evidence revision…</p>}{loadingThread&&<p role="status">Opening conversation…</p>}{busy&&!receivedId&&<div className={'chat-progress chat-typing'+(typingLeaving?' is-leaving':'')} role="status" aria-label="Meno is typing"><span className="sr-only">Meno is typing…</span><div className="chat-typing-bubble" aria-hidden="true"><span/><span/><span/></div><span className="chat-typing-status">{typingStatus}</span></div>}
 </div>
 <div className="chat-composer-area">{historyError&&(inboxCollapsed||mobile&&!historyOpen)&&<p className="chat-error" role="alert">{historyError}</p>}{!atBottom&&messages.length>0&&<button type="button" className="chat-jump" onClick={()=>{followOutput.current=true;setAtBottom(true);log.current?.scrollTo?.({top:log.current.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}}><Icon name="arrow-down"/>Latest messages</button>}{error&&<p className="chat-error" role="alert">{error}</p>}{failedTurn&&<button type="button" className="button" disabled={busy||loadingThread} onClick={()=>void submit(undefined,failedTurn)}>Try again</button>}{notice&&<p className={notice.startsWith('Answer complete')?'sr-only':'chat-muted'} role="status">{notice}</p>}
 <div className="chat-composer-context"><button type="button" className="chat-context-trigger" disabled={busy||loadingThread} aria-label={scope.kind==='vault'?'Add context':'Change context'} onClick={promptContext}><Icon name="plus"/>{scope.kind==='vault'?'Add context':'Change context'}</button>{scope.kind!=='vault'&&<span className="chat-selected-context"><Icon name={scope.kind==='folder'?'folder':scope.kind==='page'?'page':'knowledge'}/><strong data-chat-scope title={scopeTitle}>{scopeTitle}</strong><button type="button" className="chat-context-remove" aria-label="Remove context" title="Use the whole vault" disabled={busy||loadingThread} onClick={()=>changeScope({kind:'vault'})}><Icon name="close"/></button></span>}</div>
 {scope.kind!=='vault'&&<p className="chat-context-limit">Meno uses only this {scope.kind==='folder'?'folder and its subfolders':scope.kind==='page'?'note':scope.kind==='source'?'source':'entity and its directly connected material'}.</p>}
 <form className="chat-composer" onSubmit={event=>{event.preventDefault();void submit();}}>
 {!!mentions.length&&<div className="chat-mentions" aria-label="Resolved mentions">{mentions.map(mention=><button key={mention.id} type="button" disabled={busy} data-entity-id={mention.id} aria-label={`Remove mention ${mention.name}`} onClick={()=>setMentions(current=>current.filter(item=>item.id!==mention.id))}>@{mention.name} ×</button>)}</div>}
 <label className="sr-only" htmlFor="chat-question">Ask something about your knowledge</label><textarea rows={1} id="chat-question" ref={composer} value={question} disabled={loadingThread} maxLength={2000} placeholder="Message Meno…" aria-describedby="chat-provider-note" aria-controls={candidates.length?'chat-mention-list':undefined} aria-expanded={candidates.length>0} aria-activedescendant={candidates.length?`chat-mention-${Math.min(mentionIndex,candidates.length-1)}`:undefined} onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(candidates.length){if(event.key==='ArrowDown'){event.preventDefault();setMentionIndex(current=>(current+1)%candidates.length);}else if(event.key==='ArrowUp'){event.preventDefault();setMentionIndex(current=>(current+candidates.length-1)%candidates.length);}else if(event.key==='Enter'){event.preventDefault();chooseMention(candidates[mentionIndex]??candidates[0]);}}else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void submit();}}}/>
 {!!candidates.length&&<ChatContextPicker choices={candidates} selectedIndex={Math.min(mentionIndex,candidates.length-1)} onChoose={chooseMention}/>}
 <div className="chat-composer-actions"><span className="chat-composer-hint">Type @ to choose context or add a reference</span><button type="button" className="chat-depth" aria-pressed={deep} aria-label="Search more thoroughly" title="Search more thoroughly" disabled={busy} onClick={()=>setDeep(current=>!current)}><Icon name="search"/>Thorough</button>{busy?<button type="button" className="button" onClick={stop}>Stop</button>:<button type="submit" className="chat-send" aria-label="Send message" title="Send message" disabled={!question.trim()||loadingThread}><Icon name="arrow-up"/></button>}</div></form>
 {usage&&<details className="chat-usage"><summary>Response details</summary><p className="chat-provider-note" data-chat-usage>Answer usage: {usage.inputTokens??'unknown'} input tokens · {usage.outputTokens??'unknown'} output tokens · {usage.estimatedCost==null?'Cost unavailable':'Estimated $'+usage.estimatedCost.toFixed(5)}. Retrieval usage appears separately in AI activity.</p></details>}
 <p id="chat-provider-note" className="chat-provider-note">Answers use your vault. Relevant excerpts are sent to your AI provider.</p>
 </div></div>
 {selected&&<><button className="chat-evidence-backdrop" aria-label="Close evidence" onClick={dismissEvidence}/><aside className="chat-evidence" role={mobile?'dialog':undefined} aria-modal={mobile?true:undefined} aria-label="Evidence panel" tabIndex={-1} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissEvidence();}if(event.key==='Tab'&&mobile){const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0]?.focus();}}}}><header><h2>Evidence</h2><button ref={evidenceClose} type="button" className="chat-icon" aria-label="Close evidence panel" onClick={dismissEvidence}><Icon name="close"/></button></header><span className="chat-evidence-kind">{evidenceLabel(selected)}</span><h3>{selected.title}</h3><p className="chat-muted">{selected.locator}</p>{selected.status!=='current'&&<p className="chat-error" role="status">{selected.status==='deleted'?'This material is no longer available.':'This material has changed since the answer. The quotation below is the saved evidence.'}</p>}<blockquote>{selected.excerpt}</blockquote>{selected.revision!==undefined&&<p className="chat-muted">Recorded revision {selected.revision}</p>}<button type="button" className="button" disabled={selected.status!=='current'||verifying} onClick={event=>void openOriginal(selected,event.currentTarget)}>Open in original</button><div className="chat-evidence-list" aria-label="References in this answer">{messages.flatMap(message=>message.evidence?.some(item=>item.id===selected.id&&item.fingerprint===selected.fingerprint)?message.evidence:[]).map((item,index)=><button key={item.id+'-'+index} type="button" aria-current={item.id===selected.id?'true':undefined} onClick={event=>void inspectEvidence(item,event.currentTarget)}>{item.id} · {item.title}<small>{evidenceLabel(item)}{item.status!=='current'?' · '+item.status:''}</small></button>)}</div></aside></>}
 </section>;
}
