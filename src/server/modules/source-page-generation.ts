import {SourcePages,SourcePageDraft} from './source-pages.js';
import {SourceMath} from './source-math.js';
import {sourcePageVersion} from './source-page-version.js';
import {sourceGenerationDocument} from './source-document.js';
import {SourcePageEvent} from '../../shared/source-page.js';
import {Store} from '../store.js';
import {Intelligence} from './intelligence.js';
import {Vaults} from './vaults.js';
import {AIActivityLog} from './ai-activity.js';
import {AINotifications} from './ai-notifications.js';
import {HttpError} from '../validation.js';

interface Services {store:Store; sourcePages:SourcePages; intelligence:Intelligence; vaults:Vaults; activity:AIActivityLog; notifications:AINotifications}
interface GenerationRequest {
  vault:string;
  id:string;
  prepared:ReturnType<SourcePages['prepare']>;
  signal:AbortSignal;
  onEvent:(event:SourcePageEvent)=>void;
  onGenerating:()=>void;
}
export function createSourcePageGeneration({store,sourcePages,intelligence,vaults,activity,notifications}:Services) {
  return {
    prepare:(vault:string,id:string,body:Record<string,unknown>)=>sourcePages.prepare(vault,id,body,intelligence.personaSelection().id),
    async run({vault,id,prepared,signal,onEvent:emit,onGenerating}:GenerationRequest) {
      let activityId:string|undefined;
      try {
        if(prepared.existing){emit({type:'completed',page:prepared.existing});return;}
        if(prepared.review){emit({type:'review',draft:prepared.review});return;}
        emit({type:'status',phase:'thinking'});
        onGenerating();
        const input=JSON.parse(prepared.input);
        const cleanedFile=prepared.sourceRevisionId?prepared.sourceVersion.file:await new SourceMath(store).prepare(prepared.file,
          async text=>{
            const mathActivity=activity.start('source_math_preprocessing',intelligence.selection(),vault,id,'entity');
            try {
              const result=await intelligence.generate({kind:'sourceMath',input:text,background:true,onRequest:bytes=>activity.request(mathActivity,bytes,null),
                signal,
              });
              activity.finish(mathActivity,'completed',200);return result;
            }catch(error){activity.finish(mathActivity,signal.aborted?'interrupted':'failed',error instanceof HttpError?error.status:500);throw error;}
          },signal,progress=>emit({type:'status',phase:'preparing_math',progress}));
        const document=prepared.sourceRevisionId?prepared.sourceVersion.document:sourcePageVersion(store,vault,cleanedFile,'').document;
        input.untrusted_source.document=sourceGenerationDocument(document,cleanedFile.text);
        prepared.input=JSON.stringify(input);
        activityId=activity.start('create_page_from_source',intelligence.selection(),vault,id,'entity');
        emit({type:'status',phase:'thinking'});
        const recent=store.all<{duration_ms:number}>(`SELECT duration_ms FROM ai_activity WHERE action='create_page_from_source' AND status='completed' AND model=? AND reasoning_effort=? AND prompt_bytes BETWEEN ? AND ? AND duration_ms>0 ORDER BY started_at DESC LIMIT 8`,intelligence.selection().model,intelligence.selection().reasoningEffort,Buffer.byteLength(prepared.input)*.5,Buffer.byteLength(prepared.input)*2);
        if(recent.length>=3)emit({type:'estimate',seconds:Math.ceil(recent.map(row=>row.duration_ms).sort((a,b)=>a-b)[Math.floor(recent.length/2)]!/1000)});
        const draft=new SourcePageDraft(emit,cleanedFile.text,cleanedFile,prepared.options.language,document);
        // A preliminary JSON draft can be previewed, but only final-answer records are saved.
        let preview=new SourcePageDraft(emit,cleanedFile.text,cleanedFile,prepared.options.language,document),previewFailed=false;
        const resetPreview=()=>{emit({type:'preview_reset'});preview=new SourcePageDraft(emit,cleanedFile.text,cleanedFile,prepared.options.language,document);previewFailed=false;};
        await intelligence.generate({kind:'sourcePage',personaId:prepared.persona.id,personaVersion:prepared.persona.version,input:prepared.input,onRequest:bytes=>activity.request(activityId!,bytes,null),
          signal,onDelta:delta=>draft.feed(delta),onPreviewReset:resetPreview,
          onPreviewDelta:delta=>{
            if(previewFailed)return;
            try{preview.feed(delta);}catch(error){
              if(signal.aborted)throw error;
              // Prose or invalid preliminary records must never fail the final answer.
              previewFailed=true;emit({type:'preview_reset'});
            }
          },
        });
        if(signal.aborted)throw new HttpError(499,'Page generation was stopped.');
        vaults.requireOpen(vault);draft.finish();
        emit({type:'status',phase:'reviewing'});
        const review=sourcePages.stage(vault,prepared,draft,activityId);
        const notificationId=notifications.recordSource(vault,id,'completed','create_page_from_source');
        store.run('UPDATE source_page_drafts SET notification_id=? WHERE request_id=?',notificationId,prepared.requestId);
        // Commit the outcome before delivering the terminal event. A lost client can replay it.
        activity.finish(activityId,'completed',200);activityId=undefined;
        emit({type:'review',draft:review});
      }catch(error){
        if(activityId)activity.finish(activityId,signal.aborted?'interrupted':'failed',error instanceof HttpError?error.status:500);
        throw error;
      }
    },
  };
}
export type SourcePageGeneration=ReturnType<typeof createSourcePageGeneration>;
