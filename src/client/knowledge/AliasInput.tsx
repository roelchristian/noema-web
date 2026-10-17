export function AliasInput({value, onChange, disabled}: {value: string; onChange: (value: string) => void; disabled?: boolean}) {
  return <label className="entity-alias-input">Aliases<textarea aria-label="Entity aliases" placeholder="One alias per line, e.g. Trump" rows={2} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}/><small>One per line. Aliases may be shared by multiple entities.</small></label>;
}
export const parseAliases = (value: string) => value.split('\n').map(alias => alias.trim()).filter(Boolean);
