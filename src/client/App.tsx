import {resolveEntityIcon,entityIconName} from '../shared/entity-icons';
import {SubtypeIconContext} from './components/Icon';
import {ReviewCentre} from './review/ReviewCentre';
import {ReviewDestination,reviewDestinationAt} from './review/review-destination';
import type {ReviewItem} from '../shared/review-centre';
import {useCalendarSettings} from './settings/calendar-settings';
import {noteDateItems} from '../shared/note-dates';
import {DateNavigation} from './knowledge/date-navigation';
import type {TemporalDate} from '../shared/temporal';
import {NoteDatePanel,clearDateNoteDrafts} from './knowledge/NoteDatePanel';
import {CalendarWorkspace} from './calendar/CalendarWorkspace';
import {initialCalendarView,type CalendarView} from './calendar/calendar-model';
import {validateTemporalReference} from './search/temporal-navigation';
import {usePageSelection} from './state/use-page-selection';
import {presentationTraits} from './settings/appearance';
import {PresentationSelector} from './settings/PresentationSelector';
import {t as uiText} from './i18n';
import {useInterfaceLanguage} from './i18n';
import {SourceReader} from './sources/SourceReader';
import {SourcePassageDialog} from './sources/SourcePassageDialog';
import {randomUUID} from '../shared/uuid';
import {TitleText} from './components/TitleText';
import {highlightPagePassage} from './search/page-passage-highlight';
import {validateEntityMention} from './search/entity-mention-navigation';
import type {EntityMentionReference} from '../shared/entity-mentions';
import {projectPageText} from '../shared/page-text';
import type {PageReference} from '../shared/embeddings';
import {SourceViewer} from './sources/SourceViewer';
import {SourceReferencePreview} from './sources/SourceReferencePreview';
import type {SourceReference} from '../shared/domain';
import {hasUnsavedEntityDrafts} from './knowledge/entity-drafts';
import { animateSidebarClick } from './components/sidebar-motion';
import { folderBreadcrumbs, pageBreadcrumbs } from './organization/breadcrumbs';
import { inboxPages } from './organization/inbox';
import { AIActivityNotifications, AIActivityProvider, InboxActivity, AIActivityUnreadCount } from './intelligence/AIActivityNotifications';
import { SearchPanel } from './search/SearchPanel';
import { IntelligencePanel } from './intelligence/IntelligencePanel';
import { ActionMenu } from './components/ActionMenu';
import { NameDialog } from './components/NameDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import {ArchiveLibrary} from './archive/ArchiveLibrary';
import {NotificationProvider, useNotifications} from './notifications';
import {WorkspaceNotificationBridge} from './notifications/WorkspaceNotificationBridge';
import { TrashLibrary } from './trash/TrashLibrary';
import {entityLabels, entityTypes, entityMentionName, type Entity, type EntityType, type PageSummary} from '../shared/domain';
import { Select } from './components/Select';
import { WorkspaceNavigation, useMobileViewport } from './components/WorkspaceNavigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SettingsDialog } from './settings/SettingsDialog';
import {useSettingsOpen} from './settings/settings-session';
import { useAppearance } from './settings/useAppearance';
import { RecentLibrary } from './organization/RecentLibrary';
import { SidebarOrganization } from './organization/SidebarOrganization';
import { OrganizationLibrary } from './organization/OrganizationLibrary';
import { Workspace } from './state/workspace';
import { api } from './api';
import { usePageScroll } from './state/use-page-scroll';
import {captureLibraryView, useLibraryScroll} from './state/use-library-scroll';
import {useLibraryViewState} from './state/library-view-state';
import { Icon } from './components/Icon';
import { EntityPreview } from './components/EntityPreview';
import { PageToolbar } from './editor/PageToolbar';
import {PageHistoryDrawer} from './editor/PageHistoryDrawer';
import { PageEditor } from './editor/PageEditor';
import {pageHeadings} from './editor/page-headings';
import { PageDraftRecoveryNotice } from './editor/PageDraftRecoveryNotice';
import { useDocumentHistory } from './editor/use-document-history';
import { EntityPanel } from './knowledge/EntityPanel';
import { EntityHome } from './knowledge/EntityHome';
import { KnowledgeLibrary } from './knowledge/KnowledgeLibrary';
import { CreatePageFromSourceDialog } from './knowledge/CreatePageFromSourceDialog';
import { CreateEntityDialog, type CreateEntityRequest } from './knowledge/CreateEntityDialog';
import {DeleteVaultDialog} from './vaults/DeleteVaultDialog';
import { VaultBackupDialog } from './vaults/VaultBackupDialog';
import { VaultDialog, type VaultAction } from './vaults/VaultDialog';
export function App() {
  const [workspace]=useState(()=>new Workspace());
  return <ScopedNotifications workspace={workspace}><AIActivityProvider><WorkspaceApp workspace={workspace}/></AIActivityProvider></ScopedNotifications>;
}
function ScopedNotifications({workspace,children}:{workspace:Workspace;children:React.ReactNode}) {
  const scope=useSyncExternalStore(workspace.subscribe,()=>{const vault=workspace.snapshot().vault;return vault&&!vault.locked?vault.id:null;});
  return <NotificationProvider activeVaultId={scope}>{children}</NotificationProvider>;
}
function WorkspaceApp({workspace}:{workspace:Workspace}) {
  useInterfaceLanguage();
  const mobile = useMobileViewport();
  const [revealPageId, setRevealPageId] = useState<string | null>(null);
  const onRevealed = useCallback(() => setRevealPageId(null), []);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [tocVisible,setTocVisible]=useState(()=>{
    try{return localStorage.getItem('noema-table-of-contents-visible')!=='false';}catch{return true;}
  });
  useEffect(()=>{
    try{localStorage.setItem('noema-table-of-contents-visible',String(tocVisible));}catch{/* Keep the setting usable without browser storage. */}
  },[tocVisible]);
  useEffect(() => { if (!mobile) setNavigationOpen(false); }, [mobile]);
  const [aiOpen,setAiOpen]=useState(() => {
    try { return localStorage.getItem('noema-knowledge-panel-open') === 'true'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('noema-knowledge-panel-open', String(aiOpen)); }
    catch { /* Keep the panel usable when browser storage is unavailable. */ }
  }, [aiOpen]);
  const [pagePassage,setPagePassage]=useState<PageReference|null>(null);
  const [sourceReference,setSourceReference]=useState<SourceReference|null>(null);
  const sourceTrigger=useRef<HTMLElement|null>(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const [settingsOpen, setSettingsOpen] = useSettingsOpen();
  const [settingsInitialTab,setSettingsInitialTab]=useState<'appearance'|'calendar'|'intelligence'>('appearance');
  const {settings:calendarSettings,setSettings:setCalendarSettings,storageError:calendarStorageError}=useCalendarSettings();
  const [deleteTarget, setDeleteTarget] = useState<Pick<PageSummary,'id'|'title'> | null>(null);
  const [renameTarget, setRenameTarget] = useState<PageSummary | null>(null);
  const {appearance, setAppearance, exitFocus, storageError} = useAppearance();
  const notifications=useNotifications();
  const [reviewDestination,setReviewDestination]=useState<ReviewItem|null>(null);
  const reviewVault=useRef<string|null>(null);
  const [entityReviewOpen,setEntityReviewOpen]=useState(false);
  useLibraryScroll(workspace);
  usePageScroll(workspace);
  usePageSelection(workspace);
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const {vaults, vault, pages, entities:storedEntities, page, view, busy, loadingPageId, reviewing, saveStatus, organization, organizationContext, recent, trash, saveFailures, draftStorageFailures, draftRecoveries} = state;
  const entities=useMemo(()=>storedEntities.map(entity=>({...entity,icon:resolveEntityIcon(entity,appearance.subtypeIcons)})),[storedEntities,appearance.subtypeIcons]);
  useEffect(()=>{
    reviewVault.current=null;setReviewDestination(null);
  },[vault?.id,vault?.locked]);
  useEffect(()=>{
    if(!vault||vault.locked)return;
    const controller=new AbortController();
    void api.prepareLiturgical(vault.id,new Date().getFullYear(),false,controller.signal).catch(()=>{/* Download status and retry are available in Calendar settings. */});
    return()=>controller.abort();
  },[vault?.id,vault?.locked]);
  const noteDates=useMemo(()=>view==='pages'&&page&&!vault?.locked?noteDateItems(page.blocks):[],[view,page?.blocks,vault?.locked]);
  const [noteDateSelection,setNoteDateSelection]=useState<{key:string;id:string}|null>(null);
  const noteDateKey=`${vault?.id}/${page?.id}`;
  const activeNoteDate=noteDateSelection?.key===noteDateKey?noteDates.find(item=>item.id===noteDateSelection.id):undefined;
  const dateTrigger=useRef<HTMLElement|null>(null);
  const openNoteDate=useCallback((id:string)=>{
    if(!noteDates.some(item=>item.id===id))return;
    workspace.closeEntity();setSearchOpen(false);setSourceReference(null);
    setNoteDateSelection({key:noteDateKey,id});
  },[noteDates,noteDateKey,workspace]);
  const closeNoteDate=()=>{setNoteDateSelection(null);if(dateTrigger.current?.isConnected)dateTrigger.current.focus({preventScroll:true});};
  useEffect(()=>{setNoteDateSelection(null);},[noteDateKey,view,vault?.locked]);
  useEffect(()=>{
    if(view!=='pages'||vault?.locked||busy||loadingPageId!==null||reviewing||entityReviewOpen)return;
    const activate=(event:MouseEvent|KeyboardEvent)=>{
      if(event.type==='keydown'){const key=event as KeyboardEvent;if(key.key!=='Enter'&&key.key!==' '||key.isComposing)return;}
      const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-note-date]'):null;
      if(!target||!target.closest('.page, #intelligence-panel')||target.closest('[inert],dialog')||!noteDates.some(item=>item.id===target.dataset.noteDate))return;
      event.preventDefault();event.stopPropagation();dateTrigger.current=target;openNoteDate(target.dataset.noteDate!);
    };
    document.addEventListener('click',activate,true);document.addEventListener('keydown',activate,true);
    return()=>{document.removeEventListener('click',activate,true);document.removeEventListener('keydown',activate,true);};
  },[noteDates,openNoteDate,view,vault?.locked,busy,loadingPageId,reviewing,entityReviewOpen]);
  const headings=useMemo(()=>page? pageHeadings(page.blocks,entities.filter(entity=>entity.vault_id===page.vault_id)):[],[page?.blocks,page?.vault_id,entities]);
  const [calendarViews,setCalendarViews]=useState<Record<string,CalendarView>>({});
  const calendarView=calendarViews[vault?.id??'']??initialCalendarView();
  const activeReviewDestination=reviewDestinationAt(reviewDestination,reviewVault.current,{...state,calendarDateId:reviewDestination?.category==='temporal'&&reviewDestination.dateId===(calendarView.selectedId??`gregorian:${calendarView.selected?.length===4?'year':calendarView.selected?.length===7?'month':'day'}:${calendarView.selected}`)?reviewDestination.dateId:null});
  const [calendarReturn,setCalendarReturn]=useState<{vaultId:string;pageId:string;notice?:string}|null>(null);
  const [dateOrigin,setDateOrigin]=useState<{vaultId:string;pageId:string;revision:number;dateId:string;blockId:string|null;occurrence:number;returning?:boolean}|null>(null);
  const rememberDateOrigin=async()=>{if(!page||!vault||!activeNoteDate)return;const trigger=dateTrigger.current,block=trigger?.closest<HTMLElement>('[data-block-id]'),matches=block?[...block.querySelectorAll<HTMLElement>('[data-note-date]')].filter(node=>node.dataset.noteDate===activeNoteDate.id):[];const origin={vaultId:vault.id,pageId:page.id,revision:page.revision,dateId:activeNoteDate.id,blockId:block?.dataset.blockId??null,occurrence:Math.max(0,matches.indexOf(trigger!))};await workspace.saver.flush();const current=workspace.snapshot();if(current.vault?.id!==origin.vaultId||current.vault.locked||current.page?.id!==origin.pageId||current.view!=='pages')throw new Error('The original date context changed while saving. Reopen the date to continue.');setDateOrigin({...origin,revision:current.page.revision});};
  const temporalRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>{temporalRequest.current?.abort();},[vault?.id,view,calendarView.selected,calendarView.selectedId]);
  useEffect(()=>{clearDateNoteDrafts();setDateOrigin(null);setCalendarReturn(null);if(vault?.locked)setCalendarViews({});},[vault?.id,vault?.locked]);
  const changeCalendar=(patch:Partial<CalendarView>)=>{if(vault)setCalendarViews(current=>({...current,[vault.id]:{...(current[vault.id]??initialCalendarView()),...patch}}));};
  const openDateInCalendar=(date:TemporalDate)=>{run(async()=>{await rememberDateOrigin();const civil=/^(\d{4})(?:-(\d{2}))?/.exec(date.value.replace(/^~/,'')),month=civil?civil[1]+'-'+(civil[2]??'01'):calendarView.month;setNoteDateSelection(null);changeCalendar({selected:date.value,selectedId:date.id,calendar:date.calendar,month});await workspace.showCalendar();});};
  useEffect(()=>{if(!dateOrigin?.returning||page?.id!==dateOrigin.pageId||view!=='pages')return;const origin=dateOrigin;setDateOrigin(null);if(page.revision!==origin.revision){workspace.report(new Error('The original note changed. Reopen its date to locate the current passage.'));return;}setNoteDateSelection({key:`${origin.vaultId}/${origin.pageId}`,id:origin.dateId});requestAnimationFrame(()=>{const block=[...document.querySelectorAll<HTMLElement>('[data-block-id]')].find(node=>node.dataset.blockId===origin.blockId),target=block?[...block.querySelectorAll<HTMLElement>('[data-note-date]')].filter(node=>node.dataset.noteDate===origin.dateId)[origin.occurrence]:undefined;target?.scrollIntoView({block:'center'});target?.focus({preventScroll:true});});},[dateOrigin,page?.id,page?.revision,view]);
  const activePageId = view === 'pages' && !vault?.locked ? page?.id : undefined;
  const activeFolderPath = useMemo(() => {
    const location = organization.locations.find(item => item.kind === 'page' && item.item_id === activePageId);
    return folderBreadcrumbs(organization.folders, location?.folder_id).map(crumb => crumb.target!.folder);
  }, [organization, activePageId]);
  const [knowledgeBrowser, setKnowledgeBrowser] = useLibraryViewState(vault?.id ?? '', 'knowledge');
  const knowledgeType = entityTypes.includes(knowledgeBrowser.entityType as EntityType) ? knowledgeBrowser.entityType as EntityType : '';
  const [historyPage,setHistoryPage]=useState<string|null>(null);
  useEffect(()=>{if(view!=='pages'||!page||vault?.locked||historyPage!==page.vault_id+":"+page.id)setHistoryPage(null);},[view,page?.id,page?.vault_id,vault?.locked,historyPage]);
  const editingHistory = useDocumentHistory(view === 'pages' && !busy && !vault?.locked ? page : null, patch => workspace.updatePage(patch), loadingPageId !== null || reviewing || entityReviewOpen);
  // Keep every library view current while source work continues, independently
  // of whether its completion notification remains in the bell's recent items.
  const sourcesProcessing=entities.some(entity=>entity.type==='source'&&(entity.sourceStatus==='queued'||entity.sourceStatus==='processing'||entity.sourceStatus==='ready'&&(entity.sourceEnrichmentStatus==='pending'||entity.sourceEnrichmentStatus==='running')));
  useEffect(()=>{
    if(!vault||vault.locked||!sourcesProcessing)return;
    const controller=new AbortController();let refreshing=false;
    const refresh=async()=>{
      if(controller.signal.aborted||document.visibilityState!=='visible'||refreshing)return;
      refreshing=true;
      try{await workspace.refreshEntities(controller.signal);}
      catch{/* Transient failures retry on the next interval or window focus. */}
      finally{refreshing=false;}
    };
    void refresh();
    const timer=setInterval(()=>{void refresh();},1500);
    const resume=()=>{void refresh();};
    window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
  },[workspace,vault?.id,vault?.locked,sourcesProcessing]);
  const activeEntity = view === 'entity' ? entities.find(entity=>entity.id===state.entityId) : undefined;
  const activeSource = view === 'source' ? entities.find(entity=>entity.id===state.sourceId&&entity.type==='source') : undefined;
  const [sourceInspectorOpen,setSourceInspectorOpen]=useState(false);
  const [passageAction,setPassageAction]=useState<{reference:SourceReference;annotate:boolean;destinationId?:string}|null>(null);
  const inspectorToggle=useRef<HTMLButtonElement>(null);
  const [inspectorTab,setInspectorTab]=useState<'overview'|'metadata'|'connections'|'edit'>('overview');
  const [metadataDestination,setMetadataDestination]=useState<{sourceId:string;runId?:string}|null>(null);
  useEffect(()=>{
    const open=(event:Event)=>{
      const detail=(event as CustomEvent<{vaultId?:string;sourceId?:string;runId?:string}>).detail;
      if(!vault||!detail?.sourceId||detail.vaultId!==vault.id||vault.locked)return;
      const source=workspace.snapshot().entities.find(item=>item.id===detail.sourceId&&item.type==='source');
      if(!source)return;
      setMetadataDestination({sourceId:source.id,runId:detail.runId});setInspectorTab('metadata');setSourceInspectorOpen(true);
      void workspace.openSource(source.id).catch(workspace.report);
    };
    window.addEventListener('noema:open-source-metadata',open);
    return()=>window.removeEventListener('noema:open-source-metadata',open);
  },[workspace,vault?.id,vault?.locked]);
  const [activeAttachment,setActiveAttachment]=useState<{key:string;id:string}|null>(null);
  const [sourceRefresh,setSourceRefresh]=useState(0);
  const sourceKey=JSON.stringify([vault?.id,activeSource?.id]);
  const activeAttachmentChanged=useCallback((id:string)=>setActiveAttachment(current=>current?.key===sourceKey&&current.id===id?current:{key:sourceKey,id}),[sourceKey]);
  const closeInspector=useCallback(()=>{
    workspace.closeEntity();setSourceInspectorOpen(false);
    inspectorToggle.current?.focus({preventScroll:true});
  },[workspace]);
  useEffect(()=>{setPassageAction(null);},[vault?.id,vault?.locked]);
  const panelId = state.entityPanelId ?? (activeSource&&sourceInspectorOpen ? activeSource.id : null);
  useEffect(()=>{if(panelId||searchOpen||sourceReference)setNoteDateSelection(null);},[panelId,searchOpen,sourceReference]);
  useEffect(() => { setNavigationOpen(false); }, [view, page?.id, organizationContext.collection, organizationContext.folder, panelId, state.entityId, vault?.id]);
  const [sourcePage,setSourcePage]=useState<Entity|null>(null);
  const [create, setCreate] = useState<CreateEntityRequest | null>(null), [vaultAction, setVaultAction] = useState<VaultAction | null>(null);
  const [vaultDeletionOpen,setVaultDeletionOpen]=useState(false);
  const [pendingInsert,setPendingInsert]=useState<{vaultId:string;pageId:string;entityId:string;name:string;insert:(id:string)=>void}|null>(null);
  useEffect(()=>{
    if(create||!pendingInsert)return;
    // The creation dialog must release modal focus before the editor restores its saved range.
    const frame=requestAnimationFrame(()=>{
      const current=workspace.snapshot();
      if(current.vault?.id===pendingInsert.vaultId&&!current.vault.locked&&current.page?.id===pendingInsert.pageId) {
        try{pendingInsert.insert(pendingInsert.entityId);notifications.notify({tone:'success',message:uiText("Created “")+pendingInsert.name+'”.',scope:{kind:'vault',vaultId:pendingInsert.vaultId},durationMs:4000,actions:[{label:uiText('View'),run:()=>{const active=workspace.snapshot();if(active.vault?.id===pendingInsert.vaultId&&!active.vault.locked&&active.entities.some(entity=>entity.id===pendingInsert.entityId))openEntity(pendingInsert.entityId);}}]});}catch(error){workspace.report(error);}
      }
      setPendingInsert(null);
    });
    return()=>cancelAnimationFrame(frame);
  },[create,pendingInsert,workspace]);
  const [backupAction,setBackupAction]=useState<'export'|'import'|null>(null);
  const focusTarget=sourceReference?'source-viewer':activeSource?'source-reader':view==='pages'&&page?'page':null;
  const focusWorkspace = presentationTraits(appearance.presentationMode).workspaceVisibility === 'minimal' && !!focusTarget && !!vault && !vault.locked;
  useLayoutEffect(() => {
    const root=document.documentElement;
    const changed=root.dataset.focusWorkspace!==undefined&&(root.dataset.focusWorkspace!==String(focusWorkspace)||root.dataset.focusTarget!==focusTarget);
    const page=document.querySelector<HTMLElement>(focusTarget==='source-viewer'?'#source-viewer':focusTarget==='source-reader'?'#content > .source-reader':'#content > .page');
    const before=changed?page?.getBoundingClientRect():undefined;
    root.dataset.focusWorkspace = String(focusWorkspace);
    root.dataset.focusTarget = focusTarget??'';
    let motion:Animation|undefined;
    if(before&&page?.animate&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const after=page.getBoundingClientRect();
      motion=page.animate([
        {transform:`translate(${before.left-after.left}px, ${before.top-after.top}px)`,opacity:.94},
        {transform:'translate(0, 0)',opacity:1},
      ],{duration:280,easing:'cubic-bezier(.22, 1, .36, 1)'});
    }
    if (focusWorkspace && !document.activeElement?.closest('.page, .source-reader-document, .source-viewer-passages')) document.querySelector<HTMLButtonElement>('.focus-controls .presentation-focus')?.focus({preventScroll:true});
    return () => {motion?.cancel();};
  }, [focusWorkspace,focusTarget]);
  useEffect(()=>()=>{delete document.documentElement.dataset.focusWorkspace;delete document.documentElement.dataset.focusTarget;},[]);
  const knowledgeVisible = aiOpen && !activeNoteDate && !searchOpen && !panelId && !sourceReference;
  const beginSourcePage=(source:Entity)=>{sourceTrigger.current=null;setSourceReference(null);workspace.closeEntity();setAiOpen(false);setSearchOpen(false);setNavigationOpen(false);setSourcePage(source);};
  const openEntity = (id: string) => { exitFocus(); sourceTrigger.current=null;setSourceReference(null); setSearchOpen(false); if(workspace.snapshot().entities.some(entity=>entity.id===id&&entity.type==='source')) {void workspace.openSource(id).catch(workspace.report);} else if(mobile) {void workspace.openEntityHome(id).catch(workspace.report);} else workspace.openEntity(id); };
  const openEntityHome = (id: string) => { sourceTrigger.current=null;setSourceReference(null);setSearchOpen(false);void workspace.openEntityHome(id).catch(workspace.report); };
  const openSourceReference=(reference:SourceReference,trigger?:HTMLElement)=>{
    sourceTrigger.current=trigger??null;workspace.closeEntity();setSearchOpen(false);setNavigationOpen(false);setSourceReference(reference);
  };
  const closeSourceReference=()=>{const trigger=sourceTrigger.current;setSourceReference(null);sourceTrigger.current=null;requestAnimationFrame(()=>{if(trigger?.isConnected)trigger.focus({preventScroll:true});});};
  useEffect(()=>{setSourceReference(null);sourceTrigger.current=null;},[vault?.id,vault?.locked,page?.id,view]);
  useEffect(()=>{if(searchOpen||panelId)setSourceReference(null);},[searchOpen,panelId]);
  const run = (work: () => Promise<unknown>) => { void work().catch(workspace.report); };
  async function openActivityTarget(vaultId:string,id:string,kind:'page'|'entity',signal:AbortSignal) {
    if(signal.aborted)return false;
    if(workspace.snapshot().vault?.id!==vaultId) {
      await workspace.selectVault(vaultId,{vaultId,view:kind==='page'?'pages':'entity',pageId:kind==='page'?id:null,subjectId:kind==='entity'?id:null,entityId:null,collection:'',folder:''});
    } else if(kind==='page')await workspace.openPage(id);
    else {
      await workspace.refreshEntities();
      if(signal.aborted)return false;
      await workspace.openEntityHome(id);
    }
    const destination=workspace.snapshot();
    return destination.vault?.id===vaultId&&(kind==='page'?destination.view==='pages'&&destination.page?.id===id:destination.view==='source'?destination.sourceId===id:destination.view==='entity'&&destination.entityId===id);
  }

  const openIndexedPage=async(id:string,reference?:PageReference)=>{
    setSearchOpen(false);setSettingsOpen(false);setPagePassage(null);
    await workspace.openPage(id);
    const current=workspace.snapshot();
    if(reference&&current.page?.id===reference.pageId&&current.page.revision===reference.revision) {
      const names=new Map(current.entities.map(entity=>[entity.id,entityMentionName(entity)]));
      const projection=projectPageText(current.page.blocks,id=>names.get(id));
      if(projection.text.slice(reference.startOffset,reference.endOffset)===reference.excerpt)setPagePassage(reference);
    }
  };
  const openTemporalMention=async(id:string)=>{
    const origin=workspace.snapshot();if(!origin.vault||origin.vault.locked||!['calendar','pages'].includes(origin.view))return;
    if(origin.view==='pages')await rememberDateOrigin();
    temporalRequest.current?.abort();const controller=new AbortController();temporalRequest.current=controller;
    const evidence=await api.temporalMention(origin.vault.id,id,controller.signal);
    if(controller.signal.aborted||workspace.snapshot().vault?.id!==origin.vault.id||workspace.snapshot().view!==origin.view||origin.view==='pages'&&workspace.snapshot().page?.id!==origin.page?.id)return;
    temporalRequest.current=null;
    if(!('reference' in evidence))throw new Error(`${evidence.status==='stale'?'Stale evidence':'Evidence unavailable'}. ${evidence.reason}. Refresh this date before trying again.`);
    setPagePassage(null);setSearchOpen(false);workspace.closeEntity();
    await workspace.openPage(evidence.reference.pageId,{fresh:true});
    const current=workspace.snapshot();
    if(current.vault?.id!==origin.vault.id||current.vault.locked||current.view!=='pages'||!current.page||current.page.id!==evidence.reference.pageId)return;
    if(validateTemporalReference(evidence.reference,current.page,current.entities)) {setPagePassage(evidence.reference);if(origin.view==='calendar')setCalendarReturn({vaultId:origin.vault.id,pageId:current.page.id});}
    else setCalendarReturn({vaultId:origin.vault.id,pageId:current.page.id,notice:'This evidence changed while opening. Return to Calendar and refresh the date to locate its current passage.'});
  };
  const openTemporalSource=async(id:string,trigger:HTMLElement)=>{
    const origin=workspace.snapshot();if(!origin.vault||origin.vault.locked||origin.view!=='calendar')return;
    temporalRequest.current?.abort();const controller=new AbortController();temporalRequest.current=controller;
    const evidence=await api.temporalSourceMention(origin.vault.id,id,controller.signal);
    if(controller.signal.aborted||workspace.snapshot().vault?.id!==origin.vault.id||workspace.snapshot().view!=='calendar')return;
    temporalRequest.current=null;
    if(!('sourceReference' in evidence))throw new Error(`${evidence.status}: ${evidence.reason}. Refresh source evidence before opening it.`);
    openSourceReference(evidence.sourceReference,trigger);
  };
  const openEntityMention=async(reference:EntityMentionReference)=>{
    const originVault=workspace.snapshot().vault?.id;
    setSearchOpen(false);setSettingsOpen(false);setPagePassage(null);
    await workspace.openPage(reference.pageId,{fresh:true});
    const current=workspace.snapshot();
    if(current.vault?.id!==originVault||current.vault?.locked||current.view!=='pages'||current.page?.id!==reference.pageId)return;
    if(validateEntityMention(reference,current.page,current.entities))setPagePassage(reference);
    else workspace.report(new Error(uiText('This page has changed since the mention was listed. The page is open; refresh the entity homepage to locate its current mentions.')));
  };
  // Expire the navigation target itself so background updates cannot reapply it.
  useEffect(()=>{
    if(!pagePassage)return;
    const timer=setTimeout(()=>setPagePassage(current=>current===pagePassage?null:current),5000);
    return()=>clearTimeout(timer);
  },[pagePassage]);
  useEffect(()=>{
    if(!pagePassage||page?.id!==pagePassage.pageId||page.revision!==pagePassage.revision||vault?.locked||busy||loadingPageId)return;
    let cleanup=()=>{};
    const frame=requestAnimationFrame(()=>{cleanup=highlightPagePassage(pagePassage,page,entities);});
    return()=>{cancelAnimationFrame(frame);cleanup();};
  },[pagePassage,page?.id,page?.revision,vault?.id,vault?.locked,busy,loadingPageId,entities]);

  useEffect(() => { const detachNavigation = workspace.attachBrowserNavigation(); void workspace.init(); return () => { detachNavigation(); workspace.saver.dispose(); workspace.titler.dispose(); }; }, [workspace]);
  useEffect(()=>{setSearchOpen(false);},[vault?.id,vault?.locked]);
  useEffect(() => { setCreate(null); setSourcePage(null); setDeleteTarget(null); setRenameTarget(null); setVaultDeletionOpen(false); }, [vault?.id, vault?.locked]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (workspace.saver.hasPending || hasUnsavedEntityDrafts()) { e.preventDefault(); e.returnValue = ''; } };
    const nestedEscapes = new WeakSet<KeyboardEvent>();
    const captureEscape = (e: KeyboardEvent) => {
      if (!focusWorkspace || e.key !== 'Escape') return;
      // Snapshot ownership before a nested handler synchronously removes its UI.
      const menuOpen = [...document.querySelectorAll<HTMLElement>('[role=menu], [role=listbox]')].some(menu => menu.getClientRects().length > 0 || menu.contains(e.target as Node));
      if (menuOpen || document.querySelector('dialog[open], .document-find-shell[data-state="open"] .document-find, .search-panel')) nestedEscapes.add(e);
    };
    const keyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]') && workspace.snapshot().vault && !workspace.snapshot().vault?.locked) { e.preventDefault(); workspace.closeEntity(); setSearchOpen(value=>!value); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void workspace.saver.flush().catch(workspace.report); }
      if (e.key === 'Escape' && focusWorkspace) {
        if (e.isComposing || e.keyCode === 229 || document.querySelector('[data-entity-composing=true]')) return;
        if (e.defaultPrevented || nestedEscapes.has(e)) return;
        e.preventDefault(); exitFocus(); return;
      }
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) {if(document.getElementById('entity-panel'))closeInspector();else workspace.closeEntity();setSourceReference(null);if(sourceTrigger.current?.isConnected)sourceTrigger.current.focus({preventScroll:true});sourceTrigger.current=null;}
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('keydown', captureEscape, true); window.addEventListener('keydown', keyDown);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', captureEscape, true); window.removeEventListener('keydown', keyDown); };
  }, [workspace,closeInspector,focusWorkspace,exitFocus]);
  const pageLinksDisabled = busy || reviewing || entityReviewOpen || !vault || vault.locked;
  const disabled = pageLinksDisabled || loadingPageId !== null;
  const pageStatus = page ? workspace.pageSaveStatus(page.vault_id,page.id) : saveStatus;
  const activeRecovery = page && draftRecoveries.find(item=>item.vaultId===page.vault_id&&item.pageId===page.id);
  const vaultSaveFailures = saveFailures.filter(issue=>issue.vaultId===vault?.id);
  const vaultStorageFailures = draftStorageFailures.filter(issue=>issue.vaultId===vault?.id);
  const status = vault?.locked ? 'Vault locked' : {saved: 'All changes saved', pending: 'Unsaved changes', identifying: 'Identifying entities…', saving: 'Saving…', error: 'Save failed · click to retry'}[saveStatus];
  const breadcrumbs: {key: string; label: string; icon?: string; onClick?: () => void}[] = [];
  if (vault && !vault.locked) {
    if (view === 'entity') {
      breadcrumbs.push({key:'entities',label:uiText("Knowledge entities"),icon:'knowledge',onClick:()=>{setKnowledgeBrowser({entityType:''});workspace.showEntities();}});
      if(activeEntity) breadcrumbs.push({key:'entity-type:'+activeEntity.type,label:uiText(entityLabels[activeEntity.type]),icon:activeEntity.type,onClick:()=>{setKnowledgeBrowser({entityType:activeEntity.type});workspace.showEntities();}});
      breadcrumbs.push({key:'entity:'+state.entityId,label:activeEntity?.name??uiText("Knowledge entity"),icon:entityIconName(activeEntity)});
    } else if (view === 'source') {
      breadcrumbs.push({key:'sources',get label(){return uiText("Sources")},icon:'source',onClick:()=>{setKnowledgeBrowser({entityType:'source'});workspace.showEntities();}});
      breadcrumbs.push({key:'source:'+state.sourceId,label:activeSource?.name??uiText("Source"),icon:'source'});
    } else if (view === 'pages') {
      for (const crumb of pageBreadcrumbs(organization, page)) {
        const target = crumb.target;
        breadcrumbs.push({...crumb, onClick: target ? () => workspace.openOrganization(target.collection, target.folder) : undefined});
      }
    } else {
      const label = view==='review'?'Inbox':view==='calendar'?'Calendar':view==='entities'&&knowledgeType==='source'?'Sources':view === 'inbox' ? 'Inbox' : view === 'archive' ? 'Archive' : view === 'trash' ? 'Trash' : view === 'entities' ? 'Knowledge entities' : view === 'organization' ? 'Pages' : view === 'favourites' ? 'Favourites' : 'Recent items';
      const icon = view==='review'?'checklist':view==='calendar'?'event':view==='entities'&&knowledgeType==='source'?'source':view === 'inbox' ? 'inbox' : view === 'archive' ? 'archive' : view === 'trash' ? 'trash' : view === 'entities' ? 'knowledge' : view === 'organization' ? 'pages' : view === 'favourites' ? 'star' : 'recent';
      breadcrumbs.push({key: 'view', label, icon, onClick: view === 'organization' ? () => workspace.openOrganization() : view === 'entities' && knowledgeType && knowledgeType!=='source' ? () => {captureLibraryView(); setKnowledgeBrowser({entityType: ''});} : undefined});
      if (view === 'entities' && knowledgeType && knowledgeType!=='source') {
        breadcrumbs.push({key: 'entity-type:' + knowledgeType, label: uiText(entityLabels[knowledgeType]), icon: knowledgeType});
      }
      if (view === 'organization') {
        const collection = organization.collections.find(item => item.id === organizationContext.collection);
        if (collection) breadcrumbs.push({key: 'collection:' + collection.id, label: collection.name, onClick: () => workspace.openOrganization(collection.id)});
        else for (const crumb of folderBreadcrumbs(organization.folders, organizationContext.folder)) {
          breadcrumbs.push({...crumb, onClick: () => workspace.openOrganization('', crumb.target!.folder)});
        }
      }
    }
  }
  return <DateNavigation.Provider value={openDateInCalendar}><SubtypeIconContext.Provider value={appearance.subtypeIcons}><ReviewDestination.Provider value={activeReviewDestination}>
    {focusWorkspace && <div className="focus-controls" role="toolbar" aria-label="Focus controls">
      <PresentationSelector onExitFocus={exitFocus} value={appearance.presentationMode} onChange={presentationMode => setAppearance(current => ({...current, presentationMode}))}/>
    </div>}
    <WorkspaceNavigation mobile={mobile} open={navigationOpen && !focusWorkspace} onClose={() => setNavigationOpen(false)}>
    <aside className="sidebar" onClickCapture={animateSidebarClick} data-navigating={loadingPageId !== null}><div className="sidebar-heading"><a className="brand" href="/" aria-label={uiText("Noema home")}><i className="brand-mark" aria-hidden="true"/><span>noema</span></a>
      <button className="mobile-navigation-close" type="button" aria-label={uiText("Close navigation")} onClick={() => setNavigationOpen(false)}><Icon name="close"/></button>
      <button className="sidebar-new-note" type="button" aria-label={uiText("New Note")} title={uiText("New Note")} disabled={disabled || reviewing} onClick={() => { workspace.closeEntity(); setSearchOpen(false); run(() => workspace.newPage()); }}><Icon name="compose"/></button></div>
      <div className="sidebar-scroll-region">
      <nav className="sidebar-group" aria-label={uiText("Quick access")}>
        <button data-navigation-search className={'nav '+(searchOpen?'active':'')} disabled={disabled} onClick={()=>{workspace.closeEntity();setSearchOpen(value=>!value);}} aria-label={uiText("Search vault")} aria-haspopup="dialog" aria-expanded={searchOpen}><span><Icon name="search"/></span><span>{uiText("Search")}</span><kbd>⌘K</kbd></button>
        <button className={'nav ' + (view === 'favourites' ? 'active' : '')} disabled={disabled} aria-label={uiText("Favourites")} title={uiText("Favourites")} onClick={() => workspace.showOrganization(true)}><span data-icon="star"><Icon name="star"/></span><span>{uiText("Favourites")}</span></button>
        <button className={'nav ' + (view === 'recent' ? 'active' : '')} disabled={disabled} aria-label={uiText("Recent items")} title={uiText("Recent items")} onClick={() => workspace.showRecent()}><span data-icon="recent"><Icon name="recent"/></span><span>{uiText("Recent items")}</span></button>
      </nav>
      <nav className="sidebar-group" aria-label={uiText("Vault library")}>
        <div className="workspace-label">{uiText("Workspace")}</div>
        <button className={'nav ' + (view === 'pages' || view === 'organization' && !organizationContext.collection && !organizationContext.folder ? 'active' : '')} disabled={disabled} aria-label={uiText("Pages")} title={uiText("Pages")} onClick={() => run(() => workspace.showPages())}><span data-icon="pages"><Icon name="pages"/></span><span>{uiText("Pages")}</span><kbd>P</kbd></button>
        <button className={'nav ' + (view === 'calendar' ? 'active' : '')} disabled={disabled} aria-label="Calendar" title="Calendar" onClick={() => run(()=>workspace.showCalendar())}><span data-icon="event"><Icon name="event"/></span><span>Calendar</span></button>
        <button className={'nav ' + (view === 'inbox' ? 'active' : '')} disabled={disabled} aria-label={uiText("Inbox")} title={uiText("Inbox")} onClick={() => run(()=>workspace.showInbox('overview'))}><span data-icon="inbox"><Icon name="inbox"/></span><span>{uiText("Inbox")}</span></button>
        <button className={'nav ' + (view === 'source' || view === 'entities' && knowledgeType === 'source' ? 'active' : '')} disabled={disabled} aria-label={uiText("Sources")} title={uiText("Sources")} onClick={() => {captureLibraryView();setKnowledgeBrowser({entityType:'source'});workspace.showEntities();}}><span data-icon="source"><Icon name="source"/></span><span>{uiText("Sources")}</span><span className="count">{entities.filter(entity=>entity.type==='source').length}</span></button>
        <button className={'nav ' + (view === 'entity' || view === 'entities' && knowledgeType !== 'source' ? 'active' : '')} disabled={disabled} aria-label={uiText("Knowledge entities")} title={uiText("Knowledge entities")} onClick={() => {if(knowledgeType==='source'){captureLibraryView();setKnowledgeBrowser({entityType:''});}workspace.showEntities();}}><span data-icon="knowledge"><Icon name="knowledge"/></span><span>{uiText("Knowledge entities")}</span><span className="count">{entities.filter(entity=>entity.type!=='source').length}</span></button>
      </nav>
      <SidebarOrganization onArchivePages={ids=>workspace.archivePages(ids)} unfiledActive={view==='inbox'&&state.inboxFacet==='organise'} onOpenUnfiled={()=>run(()=>workspace.showInbox('organise'))} onRenamePage={(page,title)=>workspace.renamePage(page.id,title)} onDeletePage={setDeleteTarget} activePageId={activePageId} activeFolderPath={activeFolderPath} revealPageId={revealPageId} onRevealed={onRevealed} available={!!vault && !vault.locked} onOpenPage={id => run(() => workspace.openPage(id))} pages={pages} onMovePage={(id, collection, folder, remove) => workspace.locatePage(id, collection, folder, remove)} onError={workspace.report} key={vault?.id} vaultId={vault?.id} onChanged={workspace.setOrganization} data={organization} context={organizationContext} active={view === 'organization'} disabled={disabled} onOpen={(collection, folder) => workspace.openOrganization(collection, folder)}/>
      </div>
      <div id="page-section-guide"/>
      <div className="vault-controls"><label htmlFor="vault-select">{uiText("VAULT")}</label><div className="vault-picker"><Select id="vault-select" aria-label={uiText("Current vault")} value={vault?.id || ''} disabled={busy || !vaults.length} onChange={e => run(() => workspace.selectVault(e.target.value))}>{!vault && <option value="">{busy?uiText("Loading vaults…"):vaults.length?uiText("Choose a vault"):uiText("No vaults")}</option>}{vaults.map(v => <option key={v.id} value={v.id}>{v.locked ? uiText("Locked · ") : ''}{v.name}</option>)}</Select><ActionMenu label={uiText("Vault options")} disabled={busy} actions={[
        {get label(){return uiText("New vault")}, icon: 'plus', onSelect: () => setVaultAction('create')},
        {label: uiText("Import vault…"), icon: 'upload', disabled: reviewing, onSelect: () => setBackupAction('import')},
        {get label(){return uiText("Export vault backup…")}, icon: 'download', disabled: !vault || vault.locked || reviewing, onSelect: () => setBackupAction('export')},
        {label: vault?.locked ? uiText("Unlock vault") : uiText("Lock vault"), icon: 'vault', disabled: !vault, onSelect: () => { if (vault?.locked) setVaultAction('unlock'); else if (vault?.protected) run(() => workspace.lock()); else setVaultAction('lock'); }},
        {label:'Archive',icon:'archive',disabled,onSelect:()=>{workspace.closeEntity();run(()=>workspace.showArchive());}},
        {get label(){return uiText("Trash")}, icon: 'trash', disabled, onSelect: () => { workspace.closeEntity(); run(() => workspace.showTrash()); }},
        {get label(){return uiText("Settings")}, icon: 'settings', onSelect: () => setSettingsOpen(true)},
        {label: vault?.locked?uiText("Delete vault… (unlock first)"):uiText("Delete vault…"),icon:'trash',danger:true,disabled:!vault||vault.locked||reviewing,onSelect:()=>setVaultDeletionOpen(true)},
      ]}/></div></div>
    </aside>
    </WorkspaceNavigation>
    <main data-entity-review-open={entityReviewOpen} className={activeSource?'source-workspace':undefined}><header className="topbar"><button type="button" className="mobile-navigation-toggle" aria-label={uiText("Open navigation")} aria-haspopup="dialog" aria-controls="workspace-navigation" aria-expanded={mobile && navigationOpen} onClick={() => setNavigationOpen(true)}><Icon name="menu"/></button><nav id="breadcrumb" className="breadcrumbs" aria-label={uiText("Breadcrumb")}>{breadcrumbs.map((crumb, index) => <span key={crumb.key}>{index > 0 && (view === 'pages' ? <span className="breadcrumb-separator" aria-hidden="true">/</span> : <Icon name="chevron"/>)}{crumb.onClick ? <button onClick={crumb.onClick} disabled={busy || reviewing || entityReviewOpen} aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.icon && <Icon name={crumb.icon}/>}<span>{crumb.key.startsWith('page:')?<TitleText text={crumb.label}/>:crumb.label}</span></button> : <span className="breadcrumb-label" aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.icon && <Icon name={crumb.icon}/>}<span>{crumb.key.startsWith('page:')?<TitleText text={crumb.label}/>:crumb.label}</span></span>}</span>)}</nav><div id="page-identity-tools"/><div className="top-actions">{activeSource&&<PresentationSelector value={appearance.presentationMode} onChange={presentationMode=>setAppearance(current=>({...current,presentationMode}))} onExitFocus={exitFocus}/>} {activeSource&&<button type="button" ref={inspectorToggle} className="source-inspector-toggle" aria-controls="entity-panel" aria-label={uiText("Source inspector")} title={uiText("Source inspector")} aria-expanded={!!panelId} onClick={()=>{if(panelId)closeInspector();else setSourceInspectorOpen(true);}}><Icon name="knowledge"/></button>}{view === 'pages' && page && vault && !busy && !vault.locked && <PageToolbar onArchive={()=>workspace.archivePages([page.id])} onRestore={()=>workspace.restoreArchivedPages([{id:page.id,revision:page.revision}])} onHistory={()=>setHistoryPage(page.vault_id+":"+page.id)} onExitFocus={exitFocus} pages={pages} entities={entities} onOpenEntity={openEntityHome} onEntityAssociationsChanged={()=>workspace.refreshEntities()} onRename={()=>setRenameTarget(page)} tocAvailable={headings.length>0} tocVisible={tocVisible} onToggleToc={()=>setTocVisible(value=>!value)} onRevealInSidebar={() => { setNavigationOpen(true); setRevealPageId(page.id); }} onEditLockChange={(locked,password)=>workspace.setPageEditLock(locked,password)} onUndo={editingHistory.undo} onRedo={editingHistory.redo} canUndo={editingHistory.canUndo} canRedo={editingHistory.canRedo} onFeaturedImageChange={featuredImageId => editingHistory.change({featuredImageId})} onChangeBlocks={blocks => editingHistory.change({blocks})} onForward={mobile ? () => { setSearchOpen(false); run(() => workspace.goHistory(1)); } : undefined} forwardDisabled={disabled || !state.canGoForward} inactive={loadingPageId !== null} presentationMode={appearance.presentationMode} onPresentationModeChange={presentationMode => setAppearance(current => ({...current, presentationMode}))} aiOpen={knowledgeVisible} onAI={()=>{setNoteDateSelection(null);setSourceReference(null);setSearchOpen(false);workspace.closeEntity();setAiOpen(!knowledgeVisible);}} favourite={organization.favourites.some(item => item.kind === 'page' && item.item_id === page.id)} onOrganizationChange={data => { if (workspace.snapshot().vault?.id === vault.id) workspace.setOrganization(data); }} onDelete={() => workspace.deletePage(page.id)} key={vault.id + '/' + page.id} page={page} onError={workspace.report}/>}{view!=='pages'&&saveStatus!=='saved'&&!vault?.locked&&<button className={'save-state-indicator '+(saveStatus==='error'?'is-error':'')} aria-label={status} disabled={disabled} onClick={()=>run(()=>workspace.saver.flush())}><Icon name={saveStatus==='error'?'alert':'save'}/><span role="status">{status}</span></button>}<AIActivityNotifications scopeKey={vaults.map(item=>item.id+':'+item.locked).join(',')} disabled={busy||reviewing||entityReviewOpen||!vaults.some(item=>!item.locked)} onOpenActivity={()=>run(async()=>{const current=workspace.snapshot();if(current.vault&&!current.vault.locked)await workspace.showInbox('activity');else{const target=current.vaults.find(item=>!item.locked);if(target)await workspace.selectVault(target.id,{vaultId:target.id,view:'inbox',inboxFacet:'activity',pageId:null,entityId:null,collection:'',folder:''});}})} onSourceUpdates={async()=>{if(workspace.snapshot().vault&&!workspace.snapshot().vault?.locked)await workspace.refreshEntities();}} refreshKey={vaults.map(item=>item.id+':'+item.locked).join(',')+':'+saveStatus+':'+(page?.revision??'') }/></div>{vault&&!vault.locked&&!busy&&(vaultSaveFailures.length>0||vaultStorageFailures.length>0||activeRecovery)&&<div className="page-persistence-notices" aria-label={uiText("Unfinished work")}>
      {vaultSaveFailures.map(issue=><div className="page-persistence-notice is-error" key={issue.pageId} role="alert"><span>{uiText("Couldn’t save “")}{issue.title||uiText("Untitled")}”. <small>{issue.message}</small></span>{page?.id!==issue.pageId&&<button type="button" disabled={disabled} onClick={()=>run(()=>workspace.openPage(issue.pageId))}>{uiText("Open page")}</button>}<button type="button" disabled={disabled} onClick={()=>run(()=>workspace.retryPageSave(issue.vaultId,issue.pageId))}>{uiText("Retry")}</button></div>)}
      {vaultStorageFailures.map(issue=><div className="page-persistence-notice is-error" key={'storage-'+issue.pageId} role="alert"><span>“{issue.title||uiText("Untitled")}{uiText("” has no recoverable browser copy. Keep this tab open until it saves.") + " "}<small>{issue.message}</small></span><button type="button" disabled={disabled} onClick={()=>run(()=>workspace.retryPageSave(issue.vaultId,issue.pageId))}>{uiText("Retry")}</button></div>)}
      {activeRecovery&&page&&<PageDraftRecoveryNotice key={activeRecovery.vaultId+'/'+activeRecovery.pageId} recovery={activeRecovery} page={page} entities={entities} pages={pages} onRestore={entry=>workspace.restorePageDraft(entry)} onDiscard={()=>workspace.discardPageDrafts(activeRecovery.vaultId,activeRecovery.pageId)}/>}
    </div>}</header>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{loadingPageId !== null ? uiText("Opening {value0}…",{value0: pages.find(item=>item.id===loadingPageId)?.title || 'note'}) : ''}</div>
      {activeReviewDestination&&!busy&&<div className="review-return"><span className="review-return-context"><Icon name="checklist"/><span>Reviewing <strong>{activeReviewDestination.title||uiText("Untitled")}</strong></span></span><button type="button" className="button review-return-action" disabled={disabled} onClick={()=>run(()=>workspace.showInbox())}><Icon name="arrow-left"/>Return to Inbox</button></div>}
      {dateOrigin&&dateOrigin.vaultId===vault?.id&&(view==='calendar'||view==='pages'&&page?.id!==dateOrigin.pageId)&&<div className="calendar-return"><span>Opened from a date in a note.</span><button type="button" className="button" disabled={disabled} onClick={()=>{setDateOrigin({...dateOrigin,returning:true});run(()=>workspace.openPage(dateOrigin.pageId,{fresh:true}));}}>Return to original note</button></div>}
      {calendarReturn&&vault?.id===calendarReturn.vaultId&&view==='pages'&&page?.id===calendarReturn.pageId&&<div className="calendar-return"><span role={calendarReturn.notice?'alert':'status'}>{calendarReturn.notice??'Original calendar evidence · edit this page as usual.'}</span><button type="button" className="button" disabled={disabled} onClick={()=>run(()=>workspace.showCalendar())}>Return to Calendar</button></div>}
      <div id="content" data-loading={busy||loadingPageId !== null} inert={busy||entityReviewOpen||reviewing||loadingPageId !== null} aria-busy={busy||loadingPageId !== null}>
        {view==='pages'&&page?.archived_at&&<div className="page-edit-lock-status" role="status"><span>Archived · Read-only</span><button className="button small" disabled={busy} onClick={()=>run(()=>workspace.restoreArchivedPages([{id:page.id,revision:page.revision}]))}>Restore to Active</button></div>}
        {busy && view !== 'trash' && view !== 'inbox' ? <p className="loading-state" role="status">{uiText("Loading workspace…")}</p> : !vault ? <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1 className="page-heading">{vaults.length?uiText("Choose a vault"):uiText("No vaults yet")}</h1><p>{vaults.length?uiText("Choose a vault from the sidebar, or create or import one."):uiText("Create a vault or import a backup whenever you’re ready.")}</p><div className="empty-vault-actions"><button type="button" className="button primary" onClick={()=>setVaultAction('create')}>{uiText("Create a vault")}</button><button type="button" className="button" onClick={()=>setBackupAction('import')}>{uiText("Import backup")}</button></div></section> : vault?.locked ? <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1 className="page-heading">{vault.name}</h1><button className="button primary" onClick={() => setVaultAction('unlock')}>{uiText("Unlock vault")}</button></section> : vault && view === 'inbox' ? <ReviewCentre activityCount={<AIActivityUnreadCount/>} activity={<InboxActivity visible={!settingsOpen&&!(mobile&&navigationOpen)} onOpenSettings={()=>{setSettingsInitialTab('intelligence');setSettingsOpen(true);}} onOpenEntity={(vault,id,signal)=>openActivityTarget(vault,id,'entity',signal)} onOpenPage={(vault,id,signal)=>openActivityTarget(vault,id,'page',signal)}/>} key={vault.id} vaultId={vault.id} facet={state.inboxFacet} onFacetChange={facet=>run(()=>workspace.showInbox(facet))} unfiledCount={inboxPages(pages,organization).length} organize={<OrganizationLibrary onArchivePages={ids=>workspace.archivePages(ids)} disabled={busy} onRefresh={workspace.refreshInbox} onOpenPassage={openSourceReference} onOpenFolder={id => workspace.openOrganization('', id)} onNewNote={() => { workspace.closeEntity(); setSearchOpen(false); run(() => workspace.newPage()); }} inboxOnly onRenamePage={setRenameTarget} onDeletePage={setDeleteTarget} data={organization} key={vault.id} vaultId={vault.id} pages={pages} entities={entities} favouritesOnly={false} context={organizationContext} onContextChange={workspace.setOrganizationContext} onChanged={workspace.setOrganization} onOpenPage={(id,reference) => run(() => openIndexedPage(id,reference))} onOpenEntity={openEntityHome} onError={workspace.report}/>} onOpen={async(item,signal)=>{
          await workspace.saver.flush();if(signal.aborted||workspace.snapshot().vault?.id!==vault.id||workspace.snapshot().vault?.locked||workspace.snapshot().view!=='inbox')return;
          reviewVault.current=vault.id;setReviewDestination(item);setSearchOpen(false);setSourceReference(null);setNoteDateSelection(null);
          if(item.category==='scan'){setAiOpen(true);await workspace.openPage(item.originId);}
          else if(item.category==='property'){setSourceInspectorOpen(true);setInspectorTab('metadata');await workspace.openEntityHome(item.originId);}
          else if(item.category==='temporal'&&item.dateId){const value=item.dateId.split(':')[2];if(!value)return;const civil=/^(\d{4})(?:-(\d{2}))?/.exec(value.replace(/^~/,''));changeCalendar({selected:value,selectedId:item.dateId,calendar:item.dateId.startsWith('julian:')?'julian':'gregorian',month:civil?civil[1]+'-'+(civil[2]??'01'):calendarView.month});await workspace.showCalendar();}
          else if(item.category==='discovery')await workspace.openEntityHome(item.originId);
          else {setSourceInspectorOpen(item.category==='source');if(item.category==='source')setInspectorTab('overview');await workspace.openSource(item.originId);}
        }}/> : vault && view === 'calendar' ? <CalendarWorkspace settings={calendarSettings} onOpenSettings={()=>{setSettingsInitialTab('calendar');setSettingsOpen(true);}} key={vault.id} vaultId={vault.id} view={calendarView} onChange={changeCalendar} mobile={mobile} onOpenMention={openTemporalMention} onOpenSource={openTemporalSource} onOpenEntity={openEntityHome} entities={entities} evidenceOpen={!!sourceReference}/> : vault && view === 'archive' ? <ArchiveLibrary key={vault.id} vaultId={vault.id} notes={state.archive} organization={organization} onRestore={notes=>workspace.restoreArchivedPages(notes)} onOpen={id=>run(()=>workspace.openPage(id))} onRefresh={workspace.refreshArchive} onError={workspace.report}/> : vault && view === 'trash' ? <TrashLibrary key={vault.id} onRestoreSelected={ids => workspace.restorePages(ids)} onDeleteSelected={ids => workspace.permanentlyDeletePages(ids)} vaultId={vault.id} notes={trash} onRestore={id => workspace.restorePage(id)} onDelete={id => workspace.permanentlyDeletePage(id)} onRefresh={workspace.refreshTrash} onError={workspace.report}/> : vault && view === 'recent' ? <RecentLibrary organization={organization} vaultId={vault.id} recent={recent} pages={pages} entities={entities} onOpenPage={id => run(() => workspace.openPage(id))} onOpenEntity={openEntityHome}/> : vault && (view === 'organization' || view === 'favourites') ? <OrganizationLibrary onArchivePages={ids=>workspace.archivePages(ids)} disabled={busy} onRefresh={workspace.refreshInbox} onOpenPassage={openSourceReference} onOpenFolder={id => workspace.openOrganization('', id)} onNewNote={() => { workspace.closeEntity(); setSearchOpen(false); run(() => workspace.newPage()); }} inboxOnly={false} onRenamePage={setRenameTarget} onDeletePage={setDeleteTarget} data={organization} key={vault.id + view} vaultId={vault.id} pages={pages} entities={entities} favouritesOnly={view === 'favourites'} context={organizationContext} onContextChange={workspace.setOrganizationContext} onChanged={workspace.setOrganization} onOpenPage={(id,reference) => run(() => openIndexedPage(id,reference))} onOpenEntity={openEntityHome} onError={workspace.report}/> : vault && view === 'entities' ? <KnowledgeLibrary onUpdated={()=>workspace.refreshEntities()} onOpenPassage={openSourceReference} onCreatePageFromSource={beginSourcePage} onCreate={() => setCreate(knowledgeType==='source'?{source:true}:{excludeSources:true})} vaultId={vault.id} key={vault.id} entities={entities} onOpen={openEntityHome}/> : vault && view === 'entity' && state.entityId ? <EntityHome onInspect={id=>workspace.openEntity(id)} onOpenMention={reference=>run(()=>openEntityMention(reference))} onOpenSourcePassage={openSourceReference} pages={pages} onCreatePage={async()=>{
      const originVault=vault.id,originEntity=state.entityId!;
      await workspace.saver.flush();
      const current=workspace.snapshot();
      if(current.vault?.id!==originVault||current.vault.locked||current.view!=='entity'||current.entityId!==originEntity)throw new Error('Open this entity again before creating a page.');
      const created=await api.createEntityPage(originVault,originEntity,{});
      workspace.registerGeneratedPage(created);
      return created;
    }} key={vault.id+'/'+state.entityId} vaultId={vault.id} id={state.entityId} entities={entities} refreshKey={JSON.stringify([pages.map(item=>[item.id,item.title,item.updated_at]),activeEntity?.updated_at])} onOpen={openEntityHome} onOpenPage={id=>run(()=>workspace.openPage(id))} onUpdated={()=>workspace.refreshEntities()} onError={workspace.report}/> : vault && activeSource ? <SourceReader refreshKey={sourceRefresh} onActiveAttachmentChange={activeAttachmentChanged} inspectorOpen={!!panelId&&!focusWorkspace} onToggleInspector={()=>{if(panelId)closeInspector();else setSourceInspectorOpen(true);}} onRemoveReadingNote={note=>setDeleteTarget({id:note.pageId,title:note.title})} onOpenReadingNote={id=>run(()=>workspace.openPage(id))} onReadingNoteCreated={page=>workspace.registerGeneratedPage(page)} key={vault.id+'/'+activeSource.id} vaultId={vault.id} source={activeSource} entities={entities} onOpenEntity={openEntity} onCreatePageFromSource={beginSourcePage} onError={workspace.report} onAddPassage={reference=>setPassageAction({reference,annotate:false})} onAnnotate={reference=>setPassageAction({reference,annotate:true})}/> : vault && view === 'pages' && page ? <PageEditor hideTitle={state.initialEditingPageId===page.id} focusNewBody={state.creationFocusPageId===page.id} onCreationFocusConsumed={()=>workspace.consumeCreationFocus(page.id)} tocVisible={tocVisible} headings={headings} subjectsSaving={state.domainSavingPageId===page.id} citationStyle={appearance.citationStyle} pages={[...pages,...state.archive]} onOpenPage={id=>run(()=>workspace.openPage(id))} onAddAlias={workspace.addEntityAlias} saveStatus={pageStatus} onIdentify={workspace.identifyEntities} key={page.id} page={page} entities={entities} onChange={editingHistory.change} onOpenEntity={openEntity} onCreateEntity={setCreate} onSave={() => run(() => workspace.saver.flush())}/> : <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1 className="page-heading">{uiText("Your space to think")}</h1><button className="button primary" disabled={!vault} onClick={() => run(() => workspace.newPage())}>{uiText("Create your first page")}</button></section>}
      </div>
    </main>
    {knowledgeVisible && view==='pages' && page && vault && !vault.locked && !busy && <IntelligencePanel onReviewOpenChange={setEntityReviewOpen} onDomainsChange={(primary,secondary)=>workspace.setPageDomains(primary,secondary)} pages={[...pages,...state.archive]} onOpenPage={id=>run(()=>workspace.openPage(id))} inactive={loadingPageId !== null} onReview={(scanId,id,decision,edits)=>workspace.reviewEntity(scanId,id,decision,edits)} onSourcesChange={sourceIds => workspace.updatePage({sourceIds})} onCreateEntity={setCreate} entities={entities} onOpenEntity={openEntity} key={vault.id} page={page} onClose={()=>setAiOpen(false)} onSettings={()=>setSettingsOpen(true)} onFlush={async()=>{await workspace.saver.flush();return workspace.snapshot().page;}}/>}
    {activeNoteDate && !searchOpen && !panelId && !sourceReference && view==='pages' && page && vault && !vault.locked && !busy && <NoteDatePanel onOpenCalendar={openDateInCalendar} onOpenMention={openTemporalMention} calendarSettings={calendarSettings} onOpenCalendarSettings={()=>{setSettingsInitialTab('calendar');setSettingsOpen(true);}} key={noteDateKey+'/'+activeNoteDate.id} item={activeNoteDate} page={page} onClose={closeNoteDate} onOpenPage={id=>{setNoteDateSelection(null);run(()=>workspace.openPage(id));}}/>}
    {searchOpen && vault && !vault.locked && !busy && <SearchPanel onOpenPassage={openSourceReference} key={vault.id} vaultId={vault.id} pages={pages} entities={entities} onOpenPage={(id,reference)=>run(()=>openIndexedPage(id,reference))} onOpenEntity={openEntityHome} onClose={()=>setSearchOpen(false)}/>}
    {panelId && !activeNoteDate && !searchOpen && !sourcePage && !sourceReference && vault && !vault.locked && !busy && <EntityPanel onOpenHome={openEntityHome} activeAttachmentId={activeAttachment?.key===sourceKey?activeAttachment.id:undefined} metadataRunId={metadataDestination?.sourceId===panelId?metadataDestination.runId:undefined} inspectorTab={inspectorTab} onInspectorTabChange={setInspectorTab} inspector={view==='source'&&panelId===activeSource?.id} onCreatePageFromSource={beginSourcePage} onOpenPage={id => run(() => workspace.openPage(id))} refreshKey={JSON.stringify([pages.map(page => [page.id, page.title, page.updated_at]),entities.filter(entity=>entity.id===panelId).map(entity=>[entity.updated_at,entity.sourceStatus,entity.sourceEnrichmentStatus])])} key={vault.id + '/' + panelId} vaultId={vault.id} id={panelId} entities={entities} onOpen={openEntityHome} onClose={closeInspector} onUpdated={async() => {setSourceRefresh(value=>value+1);await workspace.refreshEntities();}} onError={workspace.report}/>}
    {sourceReference && vault && !vault.locked && !busy && <SourceViewer presentation={{value:appearance.presentationMode,onChange:presentationMode=>setAppearance(current=>({...current,presentationMode})),onExitFocus:exitFocus}} key={vault.id+'/'+sourceReference.id} vaultId={vault.id} reference={sourceReference} entities={entities} onClose={closeSourceReference} onOpenEntity={openEntityHome}/>}
    {vault && !vault.locked && !busy && !reviewing && !entityReviewOpen && !settingsOpen && !create && !sourcePage && !passageAction && <SourceReferencePreview key={[vault.id,view,page?.id].join('/')} entities={entities} onOpen={openSourceReference}/>}
    {vault && !vault.locked && !busy && !reviewing && !entityReviewOpen && !settingsOpen && !create && !sourcePage && !passageAction && <EntityPreview key={[vault.id, view, page?.id, state.entityId, panelId].join('/')} entities={entities} dates={noteDates} onOpenDate={openNoteDate} onOpen={openEntityHome}/>}
    {passageAction&&vault&&!vault.locked&&<SourcePassageDialog reference={passageAction.reference} annotate={passageAction.annotate} pages={pages} onClose={()=>setPassageAction(null)} onSave={async(pageId,annotation)=>{
      const vaultId=vault.id,reference=passageAction.reference;
      await workspace.saver.flush();
      const destinationId=passageAction.destinationId??pageId;
      if(destinationId) await workspace.openPage(destinationId); else await workspace.newPage();
      const current=workspace.snapshot(),target=current.page;
      if(current.vault?.id!==vaultId||current.vault.locked||current.view!=='pages'||!target||(destinationId&&target.id!==destinationId))throw new Error('Could not open the destination note.');
      if(target.editLocked)throw new Error('Unlock the destination note before adding a passage.');
      setPassageAction(action=>action?{...action,destinationId:target.id}:null);
      const quoteId='source-passage-'+reference.id;
      if(target.blocks.some(block=>block.id===quoteId)){await workspace.saver.flush();return;}
      const quote={id:quoteId,type:'quote' as const,checked:false,content:[{text:reference.excerpt},{text:' [ref]',sourceReference:{...reference,id:randomUUID()}}]};
      const blocks=[...target.blocks,quote,...(annotation?[{id:randomUUID(),type:'paragraph' as const,checked:false,content:[{text:annotation}]}]:[])];
      workspace.updatePage({blocks,sourceIds:[...new Set([...target.sourceIds,reference.sourceId])],...(!pageId?{title:entities.find(entity=>entity.id===reference.sourceId)?.name??uiText("Source note")}:{})});
      await workspace.saver.flush();
    }}/>}
    {sourcePage&&vault&&!vault.locked&&<CreatePageFromSourceDialog key={vault.id+'/'+sourcePage.id} vaultId={vault.id} source={sourcePage} onClose={()=>setSourcePage(null)} onCreated={page=>workspace.registerGeneratedPage(page)} onOpenPage={async id=>{workspace.closeEntity();await workspace.openPage(id);}} onSettings={()=>{setSourcePage(null);setSettingsOpen(true);}}/>}
    {create && vault && <CreateEntityDialog vaultId={vault.id} initial={create} onClose={() => setCreate(null)} onSubmit={async input => {
      const result = await workspace.createEntity(input);
      if (create.source && workspace.snapshot().view==='pages' && workspace.snapshot().page) workspace.updatePage({sourceIds: [...new Set([...workspace.snapshot().page!.sourceIds, result.id])]});
      if(create.intent==='insert'&&create.onCreated) {
        const current=workspace.snapshot();
        if(current.vault?.id===vault.id&&current.page)setPendingInsert({vaultId:vault.id,pageId:current.page.id,entityId:result.id,name:result.name,insert:create.onCreated});
      }else{create.onCreated?.(result.id);openEntityHome(result.id);}
    }}/>}
    {renameTarget && <NameDialog maxLength={500} title={uiText("Rename page")} value={renameTarget.title} onSave={name => workspace.renamePage(renameTarget.id,name)} onClose={() => setRenameTarget(null)}/>}
    {deleteTarget && <ConfirmDialog danger title={uiText("Move note to Trash?")} description={`“${deleteTarget.title || 'Untitled'}” will be kept in Trash for 30 days. You can restore it until then.`} action={uiText("Move to Trash")} onConfirm={() => workspace.deletePage(deleteTarget.id)} onClose={() => setDeleteTarget(null)}/>}
    {historyPage&&view==='pages'&&page&&vault&&!vault.locked&&historyPage===page.vault_id+":"+page.id&&<PageHistoryDrawer key={historyPage} page={page} entities={entities} pages={pages} saveStatus={pageStatus} onClose={()=>setHistoryPage(null)} onChange={(action,value)=>workspace.changePageHistory(action,value)}/>}
    {settingsOpen && <SettingsDialog initialTab={settingsInitialTab} calendarSettings={calendarSettings} onCalendarSettingsChange={setCalendarSettings} calendarStorageError={calendarStorageError} onExitFocus={exitFocus} onOpenPassage={async(vaultId,reference)=>{if(workspace.snapshot().vault?.id!==vaultId)await workspace.selectVault(vaultId);setSettingsOpen(false);openSourceReference(reference);}} onOpenEntity={async(vaultId,entityId)=>{if(vault?.id!==vaultId)await workspace.selectVault(vaultId);await workspace.refreshEntities();openEntityHome(entityId);setSettingsOpen(false);}} onBeforeNetworkChange={() => workspace.saver.flush()} onChangePassphrase={(current, next) => workspace.setPassphrase(current, next)} vault={vault} onOpenPage={async(vaultId,pageId,reference)=>{if(vault?.id!==vaultId)await workspace.selectVault(vaultId);await openIndexedPage(pageId,reference);}} appearance={appearance} onChange={setAppearance} storageError={storageError} onClose={() => {setSettingsOpen(false);setSettingsInitialTab('appearance');}}/>}
    {backupAction && <VaultBackupDialog action={backupAction} vaultName={vault?.name} onClose={() => setBackupAction(null)} onExport={() => workspace.exportVault()} onImport={(file,name) => workspace.importVault(file,name)}/>}
    {vaultDeletionOpen&&vault&&<DeleteVaultDialog key={vault.id} vault={vault} onPreview={()=>workspace.previewVaultDeletion(vault.id)} onExport={()=>workspace.exportVault()} onClose={()=>setVaultDeletionOpen(false)} onDelete={async confirmation=>{
      const result=await workspace.deleteVault(vault.id,confirmation);
      notifications.notify({tone:'success',message:uiText('Vault deleted.')+(result.cleanupPending?' '+uiText('Local attachment cleanup is queued and will retry.'):''),scope:{kind:'global'},durationMs:4000});
    }}/>}
    {vaultAction && <VaultDialog onImport={() => { setVaultAction(null); setBackupAction('import'); }} action={vaultAction} onClose={() => setVaultAction(null)} onSubmit={value => vaultAction === 'create' ? workspace.createVault(value) : vaultAction === 'lock' ? workspace.lock(value) : workspace.unlock(value)}/>}
    <WorkspaceNotificationBridge workspace={workspace}/>
  </ReviewDestination.Provider></SubtypeIconContext.Provider></DateNavigation.Provider>;
}
