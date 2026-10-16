import { useState } from 'react';
import { pageIcons, type PageIconId } from '../../shared/page-icons';
import { Modal } from './Modal';
import { PageIcon } from './PageIcon';

const groups = [...new Set(pageIcons.map(icon => icon.group))];
export function PageIconPicker({value, onChange}: {value?: PageIconId | null; onChange: (icon: PageIconId | null) => void}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = pageIcons.find(icon => icon.id === value);
  const filtered = pageIcons.filter(icon => `${icon.label} ${icon.group}`.toLowerCase().includes(search.trim().toLowerCase()));
  function choose(icon: PageIconId | null) { onChange(icon); setOpen(false); }
  return <>
    <button className={'page-icon-trigger' + (selected ? ' has-icon' : '')} aria-label={selected ? `Change page icon: ${selected.label}` : 'Choose page icon'} title={selected ? `Change icon · ${selected.label}` : 'Choose page icon'} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setSearch(''); setOpen(true); }}><PageIcon icon={value}/><span>{selected ? 'Change icon' : 'Add icon'}</span></button>
    {open && <Modal titleId="page-icon-title" className="page-icon-dialog" onClose={() => setOpen(false)}>
      <div className="page-icon-heading"><div><h2 id="page-icon-title">Page icon</h2></div><button className="page-icon-close" aria-label="Close icon picker" onClick={() => setOpen(false)}>×</button></div>
      <input autoFocus type="search" aria-label="Search page icons" placeholder="Search symbols…" value={search} onChange={e => setSearch(e.target.value)}/>
      <div className="page-icon-catalog">
        {groups.map(group => {
          const icons = filtered.filter(icon => icon.group === group);
          return icons.length > 0 && <section key={group} aria-label={group}><h3>{group}</h3><div className="page-icon-grid">{icons.map(icon => <button key={icon.id} className="page-icon-option" title={icon.label} aria-label={icon.label} aria-pressed={value === icon.id} onClick={() => choose(icon.id)}><PageIcon icon={icon.id}/><span>{icon.label}</span></button>)}</div></section>;
        })}
        {!filtered.length && <p className="page-icon-empty" role="status">No symbols found. Try “book”, “work”, or “star”.</p>}
      </div>
      <div className="page-icon-footer"><span>{selected ? selected.label : 'Default page icon'}</span><button className="button small" onClick={() => choose(null)}>Reset to default</button></div>
    </Modal>}
  </>;
}
