import {validSpeechWav} from './speech-cache.js';
import {speechMaxAudioBytes} from './realtime-speech.js';
import {HttpError} from '../validation.js';

/** Exact app-managed silence is part of the recording, including downloads. */
export function appendSpeechSilence(audio:Buffer,milliseconds:number):Buffer {
  if(!Number.isInteger(milliseconds)||milliseconds<0||milliseconds>3000)throw new HttpError(400,'Invalid speech pause.');
  if(!validSpeechWav(audio))throw new HttpError(502,'Generated speech audio is invalid.');
  if(!milliseconds)return audio;
  const silenceBytes=milliseconds*48;
  if(audio.length-44+silenceBytes>speechMaxAudioBytes)throw new HttpError(502,'Speech with pauses exceeds the audio limit. Select a shorter section.');
  const complete=Buffer.alloc(audio.length+silenceBytes);audio.copy(complete);complete.writeUInt32LE(complete.length-8,4);complete.writeUInt32LE(complete.length-44,40);return complete;
}
