import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {kokoroStatus,kokoroSpeech} from '../src/server/modules/kokoro-speech.ts';
import {validSpeechWav} from '../src/server/modules/speech-cache.ts';

test('Kokoro reports missing and incomplete local files without initiating a download',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'noema-kokoro-')),previous=process.env.NOEMA_KOKORO_MODEL_DIR;
  process.env.NOEMA_KOKORO_MODEL_DIR=directory;
  try {
    const status=kokoroStatus();
    assert.equal(status.ready,false);assert.equal(status.model,'kokoro-82m-v1.0');assert.equal(status.missingFiles.length,8);assert.equal(status.downloadCommand,'npm run tts:download');
    writeFileSync(join(directory,'config.json'),'partial');assert.ok(kokoroStatus().missingFiles.includes('config.json'));
    await assert.rejects(kokoroSpeech('Hello',new AbortController().signal,'puck'),error=>error.status===409&&/Download/.test(error.message));
  }finally{if(previous===undefined)delete process.env.NOEMA_KOKORO_MODEL_DIR;else process.env.NOEMA_KOKORO_MODEL_DIR=previous;rmSync(directory,{recursive:true,force:true});}
});

test('Kokoro rejects unsupported voices, invalid text and already cancelled requests',async()=>{
  await assert.rejects(kokoroSpeech('Hello',new AbortController().signal,'cedar'),error=>error.status===400);
  await assert.rejects(kokoroSpeech(' ',new AbortController().signal,'puck'),error=>error.status===400);
  await assert.rejects(kokoroSpeech('a'.repeat(4097),new AbortController().signal,'puck'),error=>error.status===400);
  const controller=new AbortController();controller.abort();
  await assert.rejects(kokoroSpeech('Hello',controller.signal,'puck'),error=>error.status===409);
});

test('Kokoro generates distinct canonical WAVs for all four voices and recovers after cancellation',{skip:process.env.NOEMA_KOKORO_SMOKE!=='1'},async()=>{
  assert.equal(kokoroStatus().ready,true,'Run npm run tts:download before the offline smoke test.');
  const outputs=[];
  for(const voice of ['puck','echo','lewis','daniel']){
    const audio=await kokoroSpeech('Hello. This speech is generated locally.',AbortSignal.timeout(30000),voice);
    assert.equal(validSpeechWav(audio),true);outputs.push(audio.toString('base64'));
  }
  assert.equal(new Set(outputs).size,4);
  const controller=new AbortController();
  const cancelled=kokoroSpeech('This passage should stop immediately. '.repeat(80),controller.signal,'puck');
  setTimeout(()=>controller.abort(),20);
  await assert.rejects(cancelled,error=>error.status===409);
  const recovered=await kokoroSpeech('Speech works after stopping.',AbortSignal.timeout(30000),'puck');
  assert.equal(validSpeechWav(recovered),true);
});
