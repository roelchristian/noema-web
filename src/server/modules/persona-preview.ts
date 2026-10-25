import {isPersonaId,parsePersonaExpression,type PersonaExpression} from '../../shared/ai-personas.js';
import {supportedIntelligencePreferences} from '../../shared/intelligence.js';
import {HttpError} from '../validation.js';

import type {PersonaPreviewInput} from '../../shared/persona-comparison.js';
/** Preview text is explicitly supplied authored/sample prose, never loaded from source storage. */
export function parsePersonaPreview(body:Record<string,unknown>):PersonaPreviewInput {
  if(typeof body.input!=='string'||!body.input.trim()||body.input.length>6000)throw new HttpError(400,'Provide a comparison passage of 1–6,000 characters.');
  if(!isPersonaId(body.personaId))throw new HttpError(400,'Choose a built-in persona.');
  if(!supportedIntelligencePreferences(body.modelSettings))throw new HttpError(400,'Choose supported comparison model settings.');
  let personaExpression:PersonaExpression;
  try{personaExpression=parsePersonaExpression(body.personaExpression);}catch{throw new HttpError(400,'Choose a supported persona expression.');}
  return {input:body.input,personaId:body.personaId,personaExpression,modelSettings:{model:body.modelSettings.model,reasoningEffort:body.modelSettings.reasoningEffort}};
}
