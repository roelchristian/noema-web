import {useEffect, useState} from 'react';
import type {Vault} from '../../shared/domain';
import type {StorageCategory, VaultStorage} from '../../shared/vault-storage';
import {request} from '../api';
import {t, getLocale} from '../i18n';

const labels: Record<StorageCategory, string> = {
  attachments: 'Attachments', sources: 'Sources', notes: 'Notes', entities: 'Entities', indexes: 'Search & AI indexes', other: 'Other vault data',
};
const descriptions: Record<StorageCategory, string> = {
  attachments: 'Images, source files, and saved originals', sources: 'Extracted text, source details, and highlights',
  notes: 'Note content and summaries, including Trash', entities: 'Entity details, properties, and relationships',
  indexes: 'Search data, embeddings, and caches', other: 'Organization, settings, and activity',
};
function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  return new Intl.NumberFormat(getLocale(), {maximumFractionDigits: index ? 1 : 0}).format(bytes / 1000 ** index) + ' ' + units[index];
}
export function StorageSettings({vault}: {vault: Vault | null}) {
  const [selected, setSelected] = useState<StorageCategory | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [data, setData] = useState<VaultStorage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!vault || vault.locked) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    request<VaultStorage>(`vaults/${encodeURIComponent(vault.id)}/storage${selected ? '?category=' + selected : ''}`, 'GET', undefined, vault.id, controller.signal)
      .then(result => {if (!controller.signal.aborted) setData(result);})
      .catch(() => {if (!controller.signal.aborted) setError(t('Could not calculate vault storage. Try again.'));})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [vault?.id, vault?.locked, refresh, selected]);
  if (!vault) return <section className="settings-section"><p>{t('Open a vault to view its storage.')}</p></section>;
  if (vault.locked) return <section className="settings-section"><p>{t('Unlock this vault to view its storage.')}</p></section>;
  function selectCategory(category: StorageCategory | null) {
    setData(null); setSelected(category); setVisibleCount(50);
  }
  const categories = data?.categories.slice().sort((a, b) => b.bytes - a.bytes);
  return <section className="settings-section vault-storage" aria-labelledby="vault-storage-heading" aria-busy={loading}>
    <div className="storage-heading"><div><h3 id="vault-storage-heading">{t('Vault storage')}</h3><p>{vault.name}</p></div>
      <button className="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{t('Refresh')}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">{t('Calculating storage…')}</p>}
    {selected && <div className="storage-detail-heading">
      <button className="button" onClick={() => selectCategory(null)}>{t('← All categories')}</button>
      <h4>{t(labels[selected])}</h4><p>{t('Largest first')}</p>
    </div>}
    {data && selected && <>
      <div className="storage-detail-total">{formatBytes(data.categories.find(item => item.id === selected)?.bytes ?? 0)} · {t('{count} items', {count: data.items?.length ?? 0})}</div>
      {!data.items?.length ? <p>{t('No items in this category.')}</p> : <ol className="storage-items">
        {data.items.slice(0, visibleCount).map(item => <li key={item.id}>
          <div><strong>{item.name}</strong><p>{t(item.detail)}</p></div><span>{formatBytes(item.bytes)}</span>
        </li>)}
      </ol>}
      {(data.items?.length ?? 0) > visibleCount && <button className="button" onClick={() => setVisibleCount(count => count + 50)}>{t('Show more')}</button>}
      <p className="storage-footnote">{selected === 'attachments' ? t('Each saved file is listed separately, including originals and extraction evidence.') : t('Database sizes are estimates. Related records are grouped under their note, source, or entity where possible.')}</p>
    </>}
    {data && !selected && <>
      <div className="storage-total"><strong>{formatBytes(data.totalBytes)}</strong><span>{t('Estimated vault size')}</span></div>
      <div className="storage-bar" role="img" aria-label={categories!.map(item => `${t(labels[item.id])}: ${formatBytes(item.bytes)}`).join(', ')}>
        {categories!.filter(item => item.bytes > 0).map(item => <span key={item.id} className={'storage-color-' + item.id} style={{width: `${item.bytes / data.totalBytes * 100}%`}} title={`${t(labels[item.id])}: ${formatBytes(item.bytes)}`}/>)}
      </div>
      <ul className="storage-categories">
        {categories!.map(item => <li key={item.id}><button className="storage-category-button" onClick={() => selectCategory(item.id)} aria-label={t('View {category} by size', {category: t(labels[item.id])})}>
          <span className={'storage-dot storage-color-' + item.id} aria-hidden="true"/>
          <div><strong>{t(labels[item.id])}</strong><p>{t(descriptions[item.id])}</p></div>
          <span className="storage-category-size">{formatBytes(item.bytes)}<small>{new Intl.NumberFormat(getLocale(), {style: 'percent', maximumFractionDigits: 1}).format(data.totalBytes ? item.bytes / data.totalBytes : 0)}</small></span>
          <span aria-hidden="true">›</span>
        </button></li>)}
      </ul>
      <p className="storage-footnote">{t('Includes {files} in files and approximately {data} in database content.', {files: formatBytes(data.fileBytes), data: formatBytes(data.dataBytes)})} {t('Shared database overhead, free space, and backups are excluded. Sizes may change as files are processed.')}</p>
    </>}
  </section>;
}
