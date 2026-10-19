import {t as uiText} from '../i18n';
import type { Vault } from '../../shared/domain';
import { EntityTypeManager } from '../knowledge/EntityTypeManager';
import { useEntitySchema } from '../knowledge/useEntitySchema';
import { defaultAppearance, type Appearance } from './appearance';

export function KnowledgeEntitySettings({vault, appearance, onChange, storageError}: {
  vault: Vault | null; appearance: Appearance; onChange: (appearance: Appearance) => void; storageError: boolean;
}) {
  return <>
    <section className="settings-section" aria-labelledby="entity-types-heading">
      <h3 id="entity-types-heading">{uiText("Types & subtypes")}</h3>
      {vault ? <><p>{uiText("Manage subtypes, shared properties, and type colors in") + " "}{vault.name}.</p><VaultEntityTypes vaultId={vault.id} appearance={appearance} onAppearanceChange={onChange}/></> : <p>{uiText("Open a vault to manage its types, subtypes, and colors.")}</p>}
    <p className="section-hint" role="status">{storageError ? uiText("Browser storage unavailable. Colors won’t persist after reload.") : uiText("Colors saved in this browser.")}</p>
    <button className="button" onClick={() => onChange({...appearance, entityColors: defaultAppearance().entityColors})}>{uiText("Restore entity colors")}</button>
    </section>
  </>;
}

function VaultEntityTypes({vaultId, appearance, onAppearanceChange}: {vaultId: string; appearance: Appearance; onAppearanceChange: (appearance: Appearance) => void}) {
  const {schema, setSchema, error} = useEntitySchema(vaultId);
  return <>{error ? <p role="alert" className="dialog-error">{error}</p> : <EntityTypeManager vaultId={vaultId} schema={schema} onChange={setSchema} entityColors={appearance.entityColors} onColorChange={(type, color) => onAppearanceChange({...appearance, entityColors: {...appearance.entityColors, [type]: color}})}/>}</>;
}
