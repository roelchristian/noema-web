import {t as uiText} from '../i18n';
import {interfaceLanguages,useInterfaceLanguage} from '../i18n';
import type {PageReference} from '../../shared/embeddings';
import { AIDebugSettings } from './AIDebugSettings';
import { ImageSettings } from './ImageSettings';
import { SecuritySettings } from './SecuritySettings';
import { useState } from 'react';
import { AIActivityLog } from './AIActivityLog';
import { IntelligenceSettings } from './IntelligenceSettings';
import { EmbeddingSettings } from './EmbeddingSettings';
import type { SourceReference, Vault } from '../../shared/domain';
import { KnowledgeEntitySettings } from './KnowledgeEntitySettings';
import { Modal, ModalHeader } from '../components/Modal';
import { Select } from '../components/Select';
import { defaultAppearance, fontOptions, themes, type Appearance, type DisplayMode, type FontId } from './appearance';

const settingsTabs = [
  {id: 'appearance', get label(){return uiText("Appearance")}},
  {id: 'images', get label(){return uiText("Images")}},
  {id: 'knowledge', get label(){return uiText("Entities")}},
  {id: 'intelligence', get label(){return uiText("AI")}},
  {id: 'security', get label(){return uiText("Security")}},
] as const;

export function SettingsDialog({appearance, onChange, storageError, onClose, onOpenPage, onOpenEntity, onOpenPassage, vault, onChangePassphrase, onBeforeNetworkChange}: {
  onChangePassphrase: (current: string, next: string | null) => Promise<void>;
  onBeforeNetworkChange: () => Promise<void>;
  vault: Vault | null;
  onOpenPassage: (vaultId:string,reference:SourceReference)=>Promise<void>;
  onOpenPage: (vaultId: string, pageId: string,reference?:PageReference) => Promise<void>;
  onOpenEntity: (vaultId: string, entityId: string) => Promise<void>;
  appearance: Appearance; onChange: (appearance: Appearance) => void; storageError: boolean; onClose: () => void;
}) {
  const {language,setLanguage,storageError:languageStorageError}=useInterfaceLanguage();
  const [tab, setTab] = useState<typeof settingsTabs[number]['id']>('appearance');
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
      <section className="settings-section appearance-setting" aria-labelledby="reading-heading">
        <h3 id="reading-heading">{uiText("Entity display")}</h3>
        <div className="display-options" role="group" aria-label={uiText("Entity display in notes")}>
          <button type="button" aria-pressed={!appearance.focusedReading} onClick={() => onChange({...appearance, focusedReading: false})}>{uiText("Highlights")}</button>
          <button type="button" aria-pressed={appearance.focusedReading} onClick={() => onChange({...appearance, focusedReading: true})}>{uiText("Underlines")}</button>
        </div>
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
      <div id="settings-panel-security" role="tabpanel" aria-labelledby="settings-tab-security" hidden={tab !== 'security'}>
        {tab === 'security' && <SecuritySettings key={vault?.id} vault={vault} onChangePassphrase={onChangePassphrase} onBeforeNetworkChange={onBeforeNetworkChange}/>}
      </div>
      </div>
      <footer className="settings-footer"><p role="status" hidden={tab !== 'appearance'}>{storageError ? uiText("Browser storage unavailable. Changes won’t persist after reload.") : uiText("Changes saved in this browser.")}</p><div><button className="button" hidden={tab !== 'appearance'} onClick={() => onChange({...defaultAppearance(), entityColors: appearance.entityColors, entityOverrides: appearance.entityOverrides})}>{uiText("Restore defaults")}</button><button className="button primary" onClick={onClose}>{uiText("Done")}</button></div></footer>
    </div>
  </Modal>;
}
