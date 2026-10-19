import {t as uiText} from '../i18n';
import { useState } from 'react';
import { imageSettingsKey, readImageCompression } from './image-settings';

export function ImageSettings() {
  const [enabled, setEnabled] = useState(readImageCompression), [error, setError] = useState('');
  function change(value: boolean) {
    try {
      localStorage.setItem(imageSettingsKey, JSON.stringify({autoCompress:value}));
      setEnabled(value); setError('');
    } catch { setError('Could not save this setting. Browser storage is unavailable.'); }
  }
  return <section className="settings-section" aria-labelledby="image-settings-heading">
    <h3 id="image-settings-heading">{uiText("Image uploads")}</h3>
    <label className="image-compression-setting"><input type="checkbox" checked={enabled} onChange={e => change(e.target.checked)}/><span>{uiText("Automatically compress images")}</span></label>
    <p>{uiText("Resize new images to 2,560 pixels on the longest side. Animated images keep their format. Turn off to keep originals.")}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
