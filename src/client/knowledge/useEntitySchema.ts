import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { builtinProperties, builtinSubtypes, type EntitySchema } from '../../shared/entity-schema';

export function useEntitySchema(vaultId: string) {
  const [schema, updateSchema] = useState<EntitySchema>({properties: builtinProperties, subtypes: builtinSubtypes, subtypeProperties: {}});
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const receive = (event: Event) => {
      const {vault, schema} = (event as CustomEvent<{vault: string; schema: EntitySchema}>).detail;
      if (vault === vaultId) updateSchema(schema);
    };
    window.addEventListener('entity-schema-changed', receive);
    void api.entitySchema(vaultId).then(result => { if (active) { updateSchema(result); setError(''); } }).catch(error => { if (active) setError(String(error)); });
    return () => { active = false; window.removeEventListener('entity-schema-changed', receive); };
  }, [vaultId]);
  const setSchema = useCallback((schema: EntitySchema) => {
    updateSchema(schema);
    window.dispatchEvent(new CustomEvent('entity-schema-changed', {detail: {vault: vaultId, schema}}));
  }, [vaultId]);
  return {schema, setSchema, error};
}
