import {Icon} from '../components/Icon';
import {CalendarSettings} from './CalendarSettings';
import type {CalendarSettings as CalendarPreferences} from './calendar-settings';
import {PresentationSelector} from './PresentationSelector';
import {StorageSettings} from './StorageSettings';
import {t as uiText} from '../i18n';
import {interfaceLanguages,useInterfaceLanguage} from '../i18n';
import type {PageReference} from '../../shared/embeddings';
import { AIDebugSettings } from './AIDebugSettings';
import { ImageSettings } from './ImageSettings';
import { SecuritySettings } from './SecuritySettings';
import { useState, type CSSProperties } from 'react';
import {useSettingsSession} from './settings-session';
import { AIActivityLog } from './AIActivityLog';
import { IntelligenceSettings } from './IntelligenceSettings';
import { EmbeddingSettings } from './EmbeddingSettings';
import {VoiceSettings} from './VoiceSettings';
import type { SourceReference, Vault } from '../../shared/domain';
import { KnowledgeEntitySettings } from './KnowledgeEntitySettings';
import { Modal, ModalHeader } from '../components/Modal';
import { Select } from '../components/Select';
import { defaultAppearance, ocsFontScales, paragraphIndentWidths, fontOptions, themes, type Appearance, type DisplayMode, type FontId, type ParagraphIndentMode, type ParagraphIndentWidth, type ParagraphSpacing } from './appearance';

const settingsTabs = [
  {id: 'appearance', icon:'sliders', get label(){return uiText("Appearance")}},
  {id: 'images', icon:'image', get label(){return uiText("Images")}},
  {id: 'calendar', icon:'page:calendar', get label(){return uiText('Calendar')}},
  {id: 'knowledge', icon:'knowledge', get label(){return uiText("Entities")}},
  {id: 'intelligence', icon:'sparkles', get label(){return uiText("AI")}},
  {id: 'voice', icon:'speaker', get label(){return uiText("Voice")}},
  {id: 'storage', icon:'archive', get label(){return uiText("Storage")}},
  {id: 'security', icon:'lock', get label(){return uiText("Security")}},
] as const;

export function SettingsDialog({initialTab='appearance',calendarSettings,onCalendarSettingsChange,calendarStorageError=false,appearance, onChange, onExitFocus, storageError, onClose, onOpenPage, onOpenEntity, onOpenPassage, vault, onChangePassphrase, onBeforeNetworkChange}: {
  initialTab?:typeof settingsTabs[number]['id'];
  calendarSettings:CalendarPreferences;onCalendarSettingsChange:(settings:CalendarPreferences)=>void;calendarStorageError?:boolean;
  onExitFocus: () => void;
  onChangePassphrase: (current: string, next: string | null) => Promise<void>;
  onBeforeNetworkChange: () => Promise<void>;
  vault: Vault | null;
  onOpenPassage: (vaultId:string,reference:SourceReference)=>Promise<void>;
  onOpenPage: (vaultId: string, pageId: string,reference?:PageReference) => Promise<void>;
  onOpenEntity: (vaultId: string, entityId: string) => Promise<void>;
  appearance: Appearance; onChange: (appearance: Appearance) => void; storageError: boolean; onClose: () => void;
}) {
  const {language,setLanguage,storageError:languageStorageError}=useInterfaceLanguage();
  const {tab,setTab,aiView,setAIView,panels}=useSettingsSession(initialTab);
  const [visited,setVisited]=useState<Set<string>>(()=>new Set([tab]));
  function selectTab(next:typeof settingsTabs[number]['id']){setTab(next);setVisited(current=>new Set([...current,next]));}
  const [activityOpen, setActivityOpen] = useState(false);
  const [indexingVisited,setIndexingVisited]=useState(aiView==='indexing');
  return <><Modal className="settings-modal" titleId="settings-title" onClose={onClose} dismissOnBackdrop>
    <div className="settings-dialog">
      <ModalHeader titleId="settings-title">{uiText("Settings")}</ModalHeader>
      <div className="settings-tabs" role="tablist" aria-orientation="vertical" aria-label={uiText("Settings categories")}>
        {settingsTabs.map(({id: category, label,icon}) => <button key={category} id={'settings-tab-' + category} role="tab" aria-selected={tab === category} aria-controls={'settings-panel-'+category} tabIndex={tab === category ? 0 : -1} onClick={() => selectTab(category)} onKeyDown={event => {
          if (['ArrowUp','ArrowDown','ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const index = settingsTabs.findIndex(item => item.id === category);
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1 : (index + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1) + settingsTabs.length) % settingsTabs.length;
            const next = settingsTabs[nextIndex]!.id;
            selectTab(next); document.getElementById('settings-tab-' + next)?.focus();
          }
        }}><Icon name={icon}/><span>{label}</span></button>)}
      </div>
      <div className="settings-panels" ref={panels}>
      <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" hidden={tab !== 'appearance'}>
      <section className="settings-section appearance-setting" aria-labelledby="interface-language-heading">
        <h3 id="interface-language-heading"><label htmlFor="settings-interface-language">{uiText("Language")}</label></h3>
        <Select id="settings-interface-language" value={language} onChange={event=>setLanguage(event.target.value as typeof language)}>
          {interfaceLanguages.map(option=><option key={option.id} value={option.id} lang={option.id}>{option.name}</option>)}
        </Select>
        <p>{uiText("Applies to menus and labels. Your content keeps its original language.")}</p>
        {languageStorageError&&<p role="status">{uiText("Browser storage unavailable. Changes won’t persist after reload.")}</p>}
      </section>
      <section className="settings-section appearance-setting" aria-labelledby="display-heading">
        <h3 id="display-heading">{uiText("Display mode")}</h3>
        <div className="display-options" role="group" aria-label={uiText("Display mode")}>
          {(['light', 'dark', 'system'] as DisplayMode[]).map(mode => <button key={mode} type="button" aria-pressed={appearance.mode === mode} onClick={() => onChange({...appearance, mode})}>{mode === 'system' ? uiText("System") : mode === 'dark' ? uiText("Dark") : uiText("Light")}</button>)}
        </div>
      </section>
      <section className="settings-section appearance-setting" aria-labelledby="typography-heading">
        <h3 id="typography-heading">{uiText("Typography")}</h3>
        <div className="font-settings">
          {([{key: 'bodyFont', get label(){return uiText("Body font")}, defaultId: 'system'}, {key: 'headingFont', get label(){return uiText("Heading font")}, defaultId: 'geist'}] as const).map(({key, label, defaultId}) => <div className="font-setting" key={key}>
            <label htmlFor={'settings-' + key}>{label}</label>
            <Select id={'settings-' + key} aria-label={label} value={appearance[key]} onChange={event => onChange({...appearance, [key]: event.target.value as FontId})}>
              {fontOptions.map(font => <option key={font.id} value={font.id}>{uiText(font.name)}{font.id === defaultId ? uiText(" (default)") : ''}</option>)}
            </Select>
          </div>)}
        </div>
        <div className="font-settings">
          <div className="font-setting">
            <label htmlFor="settings-ocs-font">{uiText("Old Church Slavonic font")}</label>
            <Select id="settings-ocs-font" value={appearance.ocsFontOverride?'shafarik':'body'} onChange={event=>onChange({...appearance,ocsFontOverride:event.target.value==='shafarik'})}>
              <option value="shafarik">{uiText("Shafarik (default)")}</option>
              <option value="body">{uiText("Use body font")}</option>
            </Select>
          </div>
          <div className="font-setting">
            <label htmlFor="settings-ocs-font-scale">{uiText("OCS font size")}</label>
            <Select id="settings-ocs-font-scale" value={appearance.ocsFontScale} disabled={!appearance.ocsFontOverride} onChange={event=>onChange({...appearance,ocsFontScale:Number(event.target.value)})}>
              {ocsFontScales.map(scale=><option key={scale} value={scale}>{Math.round(scale*100)}%{scale===1.12?uiText(" (default)"):''}</option>)}
            </Select>
          </div>
        </div>
        <div className="font-preview" aria-label={uiText("Typography preview")}>
          <h4>{uiText("A space for clear thinking")}</h4>
          <p>{uiText("Capture a thought, connect an idea, and make room for what comes next.")}</p>
        </div>
      </section>
      <section className="settings-section appearance-setting" aria-labelledby="paragraph-indent-heading">
        <h3 id="paragraph-indent-heading">{uiText("Paragraph indentation")}</h3>
        <div className="font-settings">
          <div className="font-setting">
            <label htmlFor="settings-paragraph-indent">{uiText("Indent paragraphs")}</label>
            <Select id="settings-paragraph-indent" value={appearance.paragraphIndent} onChange={event => onChange({...appearance, paragraphIndent:event.target.value as ParagraphIndentMode})}>
              <option value="none">{uiText("No indent (default)")}</option>
              <option value="all">{uiText("Indent all paragraphs")}</option>
              <option value="except-first">{uiText("Indent except first of section")}</option>
            </Select>
          </div>
          <div className="font-setting">
            <label htmlFor="settings-paragraph-indent-width">{uiText("Indent width")}</label>
            <Select id="settings-paragraph-indent-width" value={appearance.paragraphIndentWidth} disabled={appearance.paragraphIndent==='none'} onChange={event => onChange({...appearance, paragraphIndentWidth:event.target.value as ParagraphIndentWidth})}>
              <option value="small">{uiText("Small · 1 em")}</option>
              <option value="medium">{uiText("Medium · 1.5 em")}</option>
              <option value="large">{uiText("Large · 2 em")}</option>
            </Select>
          </div>
        </div>
        <div className="font-setting">
          <label htmlFor="settings-paragraph-spacing">{uiText("Paragraph spacing")}</label>
          <Select id="settings-paragraph-spacing" value={appearance.paragraphSpacing} disabled={appearance.paragraphIndent==='none'} onChange={event => onChange({...appearance, paragraphSpacing:event.target.value as ParagraphSpacing})}>
            <option value="standard">{uiText("Standard spacing (default)")}</option>
            <option value="book">{uiText("Book-style · no extra gap")}</option>
          </Select>
        </div>
        <p>{uiText("Book-style spacing removes the extra gap between consecutive paragraphs when indentation is enabled.")}</p>
        <p>{uiText("Indent only the first line. Sections begin at the start of a page and after a heading or divider.")}</p>
        <div className="font-preview paragraph-indent-preview" data-indent={appearance.paragraphIndent} data-spacing={appearance.paragraphSpacing} style={{'--paragraph-indent-width':paragraphIndentWidths[appearance.paragraphIndentWidth]} as CSSProperties} aria-label={uiText("Paragraph indentation preview")}>
          <h4>{uiText("A space for clear thinking")}</h4>
          <p>{uiText("Capture a thought, connect an idea, and make room for what comes next.")}</p>
          <p>{uiText("Each paragraph gives an idea room to grow. Follow the thread and see where it leads.")}</p>
        </div>
      </section>
      <section className="settings-section appearance-setting" aria-labelledby="reading-heading">
        <h3 id="reading-heading">Presentation</h3>
        <PresentationSelector inline onExitFocus={onExitFocus} value={appearance.presentationMode} onChange={presentationMode => onChange({...appearance, presentationMode})}/>
      </section>
      <section className="settings-section appearance-setting" aria-labelledby="citations-heading">
        <h3 id="citations-heading">{uiText("Citations")}</h3>
        <div className="display-options" role="group" aria-label={uiText("Citation display")}>
          <button type="button" aria-pressed={appearance.citationStyle==='inline'} onClick={()=>onChange({...appearance,citationStyle:'inline',citationStyleExplicit:true})}>{uiText("Inline")}</button>
          <button type="button" aria-pressed={appearance.citationStyle==='references'} onClick={()=>onChange({...appearance,citationStyle:'references',citationStyleExplicit:true})}>{uiText("Numbered")}</button>
        </div>
        <p className="display-hint">{appearance.citationStyle==='inline'?uiText("Source and page numbers beside the text."):uiText("Numbered citations with references at the end of each note.")}</p>
      </section>
      <section className="settings-section appearance-setting" aria-labelledby="theme-heading">
        <h3 id="theme-heading">{uiText("Accent color")}</h3>
        <div className="theme-options" role="group" aria-label={uiText("Accent color")}>
          {themes.map(theme => <button key={theme.id} className="theme-option" title={uiText(theme.description)} aria-pressed={appearance.theme === theme.id} onClick={() => onChange({...appearance, theme: theme.id})}>
            <span className="theme-swatch" style={{background: theme.soft, color: theme.color}}><span style={{background: theme.color}}/>{appearance.theme === theme.id && <span className="theme-check">✓</span>}</span>
            <strong>{uiText(theme.name)}</strong>{theme.id === 'ink' && <span className="theme-default">{uiText("Default")}</span>}
          </button>)}
        </div>
      </section>
      </div>
      <div id="settings-panel-calendar" role="tabpanel" aria-labelledby="settings-tab-calendar" hidden={tab !== 'calendar'}>
        {visited.has('calendar') && <CalendarSettings value={calendarSettings} onChange={onCalendarSettingsChange} vault={vault} storageError={calendarStorageError}/>}
      </div>
      <div id="settings-panel-images" role="tabpanel" aria-labelledby="settings-tab-images" hidden={tab !== 'images'}>
        {visited.has('images') && <ImageSettings/>}
      </div>
      <div id="settings-panel-knowledge" role="tabpanel" aria-labelledby="settings-tab-knowledge" hidden={tab !== 'knowledge'}>
        {visited.has('knowledge') && <KnowledgeEntitySettings key={vault?.id} vault={vault} appearance={appearance} onChange={onChange} storageError={storageError}/>}
      </div>
      <div id="settings-panel-intelligence" role="tabpanel" aria-labelledby="settings-tab-intelligence" hidden={tab !== 'intelligence'}>
        <div hidden={aiView!=='overview'}>{visited.has('intelligence')&&<IntelligenceSettings active={tab==='intelligence'&&aiView==='overview'}/>}</div>
        {aiView!=='overview'&&<button className="button settings-back" onClick={()=>setAIView('overview')}>Back to AI</button>}
        <div hidden={aiView!=='indexing'}>{indexingVisited&&<EmbeddingSettings active={tab==='intelligence'&&aiView==='indexing'} onOpenPassage={onOpenPassage} key={vault?.id} vault={vault} onOpenPage={onOpenPage} onOpenEntity={onOpenEntity}/>}</div>
        {aiView==='diagnostics'&&tab==='intelligence'&&<AIDebugSettings/>}
        {aiView==='overview'&&<section className="settings-section settings-ai-tools">
          <div className="settings-overview-row"><span><strong>Search indexing</strong><small>Configure and manage semantic indexing for this vault</small></span><button className="button" onClick={()=>{setIndexingVisited(true);setAIView('indexing');}}>Manage indexing</button></div>
          <div className="settings-overview-row"><span><strong>Activity & usage</strong><small>Requests, tokens and available cost estimates</small></span><button className="button" aria-haspopup="dialog" onClick={()=>setActivityOpen(true)}>Open activity log</button></div>
          <button className="button" onClick={()=>setAIView('diagnostics')}>Advanced diagnostics</button>
        </section>}
      </div>
      <div id="settings-panel-voice" role="tabpanel" aria-labelledby="settings-tab-voice" hidden={tab !== 'voice'}>
        {visited.has('voice')&&<VoiceSettings vaultId={vault&&!vault.locked?vault.id:undefined} active={tab==='voice'}/>}
      </div>
      <div id="settings-panel-storage" role="tabpanel" aria-labelledby="settings-tab-storage" hidden={tab !== 'storage'}>
        {visited.has('storage') && <StorageSettings key={vault?.id} vault={vault}/>}
      </div>
      <div id="settings-panel-security" role="tabpanel" aria-labelledby="settings-tab-security" hidden={tab !== 'security'}>
        {visited.has('security') && <SecuritySettings key={vault?.id} vault={vault} onChangePassphrase={onChangePassphrase} onBeforeNetworkChange={onBeforeNetworkChange}/>}
      </div>
      </div>
      <footer className="settings-footer"><p role="status" hidden={tab !== 'appearance'}>{storageError ? uiText("Browser storage unavailable. Changes won’t persist after reload.") : uiText("Changes saved in this browser.")}</p><div><button className="button" hidden={tab !== 'appearance'} onClick={() => onChange({...defaultAppearance(), entityColors: appearance.entityColors, entityOverrides: appearance.entityOverrides,subtypeIcons:appearance.subtypeIcons})}>{uiText("Restore defaults")}</button><button className="button primary" onClick={onClose}>{uiText("Done")}</button></div></footer>
    </div>
  </Modal>{activityOpen&&<AIActivityLog onOpenPage={onOpenPage} onClose={() => setActivityOpen(false)}/>}</>;
}
