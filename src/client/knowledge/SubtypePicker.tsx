import type { EntityType } from '../../shared/domain';
import type { EntitySubtype } from '../../shared/entity-schema';

export function SubtypePicker({type, value, subtypes, onChange, disabled}: {type: EntityType; value: string[]; subtypes: EntitySubtype[]; onChange: (value: string[]) => void; disabled?: boolean}) {
  return <fieldset className="subtype-picker" disabled={disabled}><legend>Subtypes</legend><p className="section-hint">{type === 'organism' ? 'Choose a biological group and Taxon or Individual, as applicable.' : type === 'culture' ? 'Choose Language or Nationality, as applicable.' : 'Choose any that apply.'}</p><div>{subtypes.filter(s => s.type === type).map(s => <label key={s.id}><input type="checkbox" checked={value.includes(s.id)} onChange={event => onChange(event.target.checked ? [...value, s.id] : value.filter(id => id !== s.id))}/><span>{s.name}</span></label>)}</div></fieldset>;
}
