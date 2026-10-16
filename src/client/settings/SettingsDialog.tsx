import { useState } from 'react';
import { AIActivityLog } from './AIActivityLog';
import { IntelligenceSettings } from './IntelligenceSettings';
import { entityLabels, entityTypes } from '../../shared/domain';
import { ColorPicker } from './ColorPicker';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { defaultAppearance, themes, type Appearance, type DisplayMode } from './appearance';

export function SettingsDialog({appearance, onChange, storageError, onClose, onOpenPage}: {
  onOpenPage: (vaultId: string, pageId: string) => Promise<void>;
  appearance: Appearance; onChange: (appearance: Appearance) => void; storageError: boolean; onClose: () => void;
}) {
  const [tab, setTab] = useState<'appearance' | 'intelligence'>('appearance');
  const [activityOpen, setActivityOpen] = useState(false);
  if (activityOpen) return <AIActivityLog onOpenPage={onOpenPage} onClose={() => setActivityOpen(false)}/>;
  return <Modal className="settings-modal" titleId="settings-title" onClose={onClose}>
    <div className="settings-dialog">
      <header className="settings-heading"><div><div className="dialog-eyebrow">MAKE YOURSELF AT HOME</div><h2 id="settings-title">Settings</h2></div><button className="settings-close" aria-label="Close settings" onClick={onClose}>×</button></header>
      <div className="settings-tabs" role="tablist" aria-label="Settings categories">
        {(['appearance', 'intelligence'] as const).map(category => <button key={category} id={'settings-tab-' + category} role="tab" aria-selected={tab === category} aria-controls={'settings-panel-' + category} tabIndex={tab === category ? 0 : -1} onClick={() => setTab(category)} onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 'appearance' : event.key === 'End' ? 'intelligence' : tab === 'appearance' ? 'intelligence' : 'appearance';
            setTab(next); document.getElementById('settings-tab-' + next)?.focus();
          }
        }}>{category === 'appearance' ? 'Appearance' : 'Intelligence'}</button>)}
      </div>
      <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" hidden={tab !== 'appearance'}>
      <section className="settings-section" aria-labelledby="display-heading">
        <h3 id="display-heading">Appearance</h3><p>Choose a light or dark workspace, or follow your computer.</p>
        <div className="display-options" role="group" aria-label="Appearance">
          {(['light', 'dark', 'system'] as DisplayMode[]).map(mode => <button key={mode} type="button" aria-pressed={appearance.mode === mode} onClick={() => onChange({...appearance, mode})}>{mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light'}</button>)}
        </div>
        <p className="display-hint">{appearance.mode === 'system' ? 'Matches your computer and updates automatically.' : `Always use ${appearance.mode} mode.`}</p>
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
      <section className="settings-section" aria-labelledby="entity-colors-heading">
        <h3 id="entity-colors-heading">Knowledge entity colors</h3><p>Choose a color for each type. Mentions use a soft tint and contrasting text, so your pages stay easy to read in either mode.</p>
        <div className="entity-color-list">{entityTypes.map(type => <div className="entity-color-row" key={type}>
          <label htmlFor={'color-' + type}>{entityLabels[type]}</label>
          <span className={'mention ' + type} aria-hidden="true"><Icon name={type}/>{entityLabels[type]}</span>
          <ColorPicker id={'color-' + type} label={entityLabels[type] + ' color'} value={appearance.entityColors[type]} onChange={color => onChange({...appearance, entityColors: {...appearance.entityColors, [type]: color}})}/>
        </div>)}</div>
      </section>
      </div>
      <div id="settings-panel-intelligence" role="tabpanel" aria-labelledby="settings-tab-intelligence" hidden={tab !== 'intelligence'}>
        <IntelligenceSettings/>
        <section className="settings-section settings-activity-entry"><div><h3>AI activity log</h3><p>Review local AI requests, export a CSV, or clear activity.</p></div><button className="button" aria-haspopup="dialog" onClick={() => setActivityOpen(true)}>Open activity log</button></section>
      </div>
      <footer className="settings-footer"><p role="status" hidden={tab !== 'appearance'}>{storageError ? 'Applied for now. Browser storage is unavailable; changes won’t survive a reload.' : 'Appearance changes apply instantly and save in this browser.'}</p><div><button className="button" hidden={tab !== 'appearance'} onClick={() => onChange(defaultAppearance())}>Restore defaults</button><button className="button primary" onClick={onClose}>Done</button></div></footer>
    </div>
  </Modal>;
}
