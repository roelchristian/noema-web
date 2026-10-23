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
import { AIActivityLog } from './AIActivityLog';
import { IntelligenceSettings } from './IntelligenceSettings';
import { EmbeddingSettings } from './EmbeddingSettings';
import type { SourceReference, Vault } from '../../shared/domain';
import { KnowledgeEntitySettings } from './KnowledgeEntitySettings';
import { Modal, ModalHeader } from '../components/Modal';
import { Select } from '../components/Select';
import { defaultAppearance, paragraphIndentWidths, fontOptions, themes, type Appearance, type DisplayMode, type FontId, type ParagraphIndentMode, type ParagraphIndentWidth, type ParagraphSpacing } from './appearance';

const settingsTabs = [
  {id: 'appearance', get label(){return uiText("Appearance")}},
  {id: 'images', get label(){return uiText("Images")}},
  {id: 'calendar', get label(){return uiText('Calendar')}},
  {id: 'knowledge', get label(){return uiText("Entities")}},
  {id: 'intelligence', get label(){return uiText("AI")}},
  {id: 'storage', get label(){return uiText("Storage")}},
  {id: 'security', get label(){return uiText("Security")}},
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
  const [tab, setTab] = useState<typeof settingsTabs[number]['id']>(initialTab);
  const [activityOpen, setActivityOpen] = useState(false);
  if (activityOpen) return <AIActivityLog onOpenPage={onOpenPage} onClose={() => setActivityOpen(false)}/>;
  return <Modal className="settings-modal" titleId="settings-title" onClose={onClose} dismissOnBackdrop>
    <div className="settings-dialog">
      <ModalHeader titleId="settings-title">{uiText("Settings")}</ModalHeader>
      <div className="settings-tabs" role="tablist" aria-label={uiText("Settings categories")}>
        {settingsTabs.map(({id: category, label}) => <button key={category} id={'settings-tab-' + category} role="tab" aria-selected={tab === category} aria-controls={'settings-panel-' + category} tabIndex={tab === category ? 0 : -1} onClick={() => setTab(category)} onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const index = settingsTabs.findIndex(item => item.id === category);
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + settingsTabs.length) % settingsTabs.length;
            const next = settingsTabs[nextIndex]!.id;
            setTab(next); document.getElementById('settings-tab-' + next)?.focus();
          }
        }}>{label}</button>)}
      </div>
      <div className="settings-panels">
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
        <PresentationSelector onExitFocus={onExitFocus} value={appearance.presentationMode} onChange={presentationMode => onChange({...appearance, presentationMode})}/>
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
        {tab === 'calendar' && <CalendarSettings value={calendarSettings} onChange={onCalendarSettingsChange} vault={vault} storageError={calendarStorageError}/>}
      </div>
      <div id="settings-panel-images" role="tabpanel" aria-labelledby="settings-tab-images" hidden={tab !== 'images'}>
        {tab === 'images' && <ImageSettings/>}
      </div>
      <div id="settings-panel-knowledge" role="tabpanel" aria-labelledby="settings-tab-knowledge" hidden={tab !== 'knowledge'}>
        {tab === 'knowledge' && <KnowledgeEntitySettings key={vault?.id} vault={vault} appearance={appearance} onChange={onChange} storageError={storageError}/>}
      </div>
      <div id="settings-panel-intelligence" role="tabpanel" aria-labelledby="settings-tab-intelligence" hidden={tab !== 'intelligence'}>
        <IntelligenceSettings/>
        {tab === 'intelligence' && <details className="settings-advanced"><summary>{uiText("AI diagnostics")}</summary><AIDebugSettings/></details>}
        {tab === 'intelligence' && <details className="settings-advanced"><summary>{uiText("Search indexing")}</summary><EmbeddingSettings onOpenPassage={onOpenPassage} key={vault?.id} vault={vault} onOpenPage={onOpenPage} onOpenEntity={onOpenEntity}/></details>}
        <section className="settings-section settings-activity-entry"><div><h3>{uiText("AI activity log")}</h3></div><button className="button" aria-haspopup="dialog" onClick={() => setActivityOpen(true)}>{uiText("Open activity log")}</button></section>
      </div>
      <div id="settings-panel-storage" role="tabpanel" aria-labelledby="settings-tab-storage" hidden={tab !== 'storage'}>
        {tab === 'storage' && <StorageSettings key={vault?.id} vault={vault}/>}
      </div>
      <div id="settings-panel-security" role="tabpanel" aria-labelledby="settings-tab-security" hidden={tab !== 'security'}>
        {tab === 'security' && <SecuritySettings key={vault?.id} vault={vault} onChangePassphrase={onChangePassphrase} onBeforeNetworkChange={onBeforeNetworkChange}/>}
      </div>
      </div>
      <footer className="settings-footer"><p role="status" hidden={tab !== 'appearance'}>{storageError ? uiText("Browser storage unavailable. Changes won’t persist after reload.") : uiText("Changes saved in this browser.")}</p><div><button className="button" hidden={tab !== 'appearance'} onClick={() => onChange({...defaultAppearance(), entityColors: appearance.entityColors, entityOverrides: appearance.entityOverrides})}>{uiText("Restore defaults")}</button><button className="button primary" onClick={onClose}>{uiText("Done")}</button></div></footer>
    </div>
  </Modal>;
}
