import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket,{WebSocketServer} from 'ws';
import {realtimeSpeech,speechEndpoint} from '../src/server/modules/realtime-speech.ts';

test('Realtime speech exchanges authenticated WebSocket events and produces playable WAV',async t=>{
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 t.after(async()=>{for(const client of server.clients)client.terminate();await new Promise(resolve=>server.close(resolve));});
 const received=[];let authorization;
 const pcm=Buffer.from([0,0,255,127,0,128]);
 server.on('connection',(socket,request)=>{
  authorization=request.headers.authorization;
  socket.on('message',message=>{
   const event=JSON.parse(message.toString());received.push(event);
   if(event.type==='session.update')socket.send(JSON.stringify({type:'session.updated'}));
   if(event.type==='response.create'){
    socket.send(JSON.stringify({type:'response.output_audio.delta',delta:pcm.toString('base64')}));
    socket.send(JSON.stringify({type:'response.done',response:{status:'completed',usage:{input_tokens:12,output_tokens:5}}}));
   }
  });
 });
 let usage;
 const factory=(url,options)=>{assert.equal(url,speechEndpoint);return new WebSocket('ws://127.0.0.1:'+server.address().port,options);};
 const wav=await realtimeSpeech('Read this exactly.[ref][??][L: 1–2]','test-key',AbortSignal.timeout(5000),factory,{usage:value=>{usage=value;}});
 assert.equal(authorization,'Bearer test-key');
 assert.deepEqual(received.map(event=>event.type),['session.update','response.create']);
 assert.deepEqual(received[1].response.input,[{type:'message',role:'user',content:[{type:'input_text',text:'Read this exactly.'}]}]);
 assert.ok(!JSON.stringify(received).includes('[ref]'));assert.ok(!JSON.stringify(received).includes('[L:'));
 assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(4),wav.length-8);
 assert.equal(wav.toString('ascii',8,12),'WAVE');assert.equal(wav.readUInt32LE(40),pcm.length);
 assert.deepEqual(wav.subarray(44),pcm);assert.equal(usage.input_tokens,12);assert.equal(usage.output_tokens,5);
});
