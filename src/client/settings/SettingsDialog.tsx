import { ImageSettings } from './ImageSettings';
import { useState } from 'react';
import { AIActivityLog } from './AIActivityLog';
import { IntelligenceSettings } from './IntelligenceSettings';
import { EmbeddingSettings } from './EmbeddingSettings';
import type { Vault } from '../../shared/domain';
import { KnowledgeEntitySettings } from './KnowledgeEntitySettings';
import { Modal } from '../components/Modal';
import { defaultAppearance, themes, type Appearance, type DisplayMode } from './appearance';

const settingsTabs = [
  {id: 'appearance', label: 'Appearance'},
  {id: 'images', label: 'Images'},
  {id: 'knowledge', label: 'Knowledge Entities'},
  {id: 'intelligence', label: 'Intelligence'},
] as const;

export function SettingsDialog({appearance, onChange, storageError, onClose, onOpenPage, vault}: {
  vault: Vault | null;
  onOpenPage: (vaultId: string, pageId: string) => Promise<void>;
  appearance: Appearance; onChange: (appearance: Appearance) => void; storageError: boolean; onClose: () => void;
}) {
  const [tab, setTab] = useState<typeof settingsTabs[number]['id']>('appearance');
  const [activityOpen, setActivityOpen] = useState(false);
  if (activityOpen) return <AIActivityLog onOpenPage={onOpenPage} onClose={() => setActivityOpen(false)}/>;
  return <Modal className="settings-modal" titleId="settings-title" onClose={onClose} dismissOnBackdrop>
    <div className="settings-dialog">
      <header className="settings-heading"><div><h2 id="settings-title">Settings</h2></div><button className="settings-close" aria-label="Close settings" onClick={onClose}>×</button></header>
      <div className="settings-tabs" role="tablist" aria-label="Settings categories">
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
      <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" hidden={tab !== 'appearance'}>
      <section className="settings-section" aria-labelledby="display-heading">
        <h3 id="display-heading">Appearance</h3><p>Choose a light or dark workspace, or follow your computer.</p>
        <div className="display-options" role="group" aria-label="Appearance">
          {(['light', 'dark', 'system'] as DisplayMode[]).map(mode => <button key={mode} type="button" aria-pressed={appearance.mode === mode} onClick={() => onChange({...appearance, mode})}>{mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light'}</button>)}
        </div>
        <p className="display-hint">{appearance.mode === 'system' ? 'Matches your computer and updates automatically.' : `Always use ${appearance.mode} mode.`}</p>
      </section>
      <section className="settings-section" aria-labelledby="reading-heading">
        <h3 id="reading-heading">Focused reading</h3><p>Hide entity icons and highlights in notes. A thin, muted underline keeps connected entities easy to find.</p>
        <div className="display-options" role="group" aria-label="Entity display in notes">
          <button type="button" aria-pressed={!appearance.focusedReading} onClick={() => onChange({...appearance, focusedReading: false})}>Highlights</button>
          <button type="button" aria-pressed={appearance.focusedReading} onClick={() => onChange({...appearance, focusedReading: true})}>Focused reading</button>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="theme-heading">
        <h3 id="theme-heading">Theme color</h3><p>A little character for buttons, navigation, and accents.</p>
        <div className="theme-options" role="group" aria-label="Theme color">
          {themes.map(theme => <button key={theme.id} className="theme-option" aria-pressed={appearance.theme === theme.id} onClick={() => onChange({...appearance, theme: theme.id})}>
            <span className="theme-swatch" style={{background: theme.soft, color: theme.color}}><span style={{background: theme.color}}/>{appearance.theme === theme.id && <span className="theme-check">✓</span>}</span>
            <strong>{theme.name}</strong><small>{theme.description}</small>{theme.id === 'ink' && <span className="theme-default">Default</span>}
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
        {tab === 'intelligence' && <EmbeddingSettings key={vault?.id} vault={vault} onOpenPage={onOpenPage}/>}
        <section className="settings-section settings-activity-entry"><div><h3>AI activity log</h3><p>Review local AI requests, export a CSV, or clear activity.</p></div><button className="button" aria-haspopup="dialog" onClick={() => setActivityOpen(true)}>Open activity log</button></section>
      </div>
      <footer className="settings-footer"><p role="status" hidden={tab !== 'appearance'}>{storageError ? 'Applied for now. Browser storage is unavailable; changes won’t survive a reload.' : 'Appearance changes apply instantly and save in this browser.'}</p><div><button className="button" hidden={tab !== 'appearance'} onClick={() => onChange({...defaultAppearance(), entityColors: appearance.entityColors, entityOverrides: appearance.entityOverrides})}>Restore defaults</button><button className="button primary" onClick={onClose}>Done</button></div></footer>
    </div>
  </Modal>;
}
