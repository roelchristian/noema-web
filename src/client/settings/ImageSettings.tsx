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
    <h3 id="image-settings-heading">Image uploads</h3>
    <label className="image-compression-setting"><input type="checkbox" checked={enabled} onChange={e => change(e.target.checked)}/><span>Automatically compress images</span></label>
    <p>Reduce image file sizes when pasting or adding images. Large images are resized to a maximum of 2,560 pixels on the longest side. Animated images keep their original format.</p>
    <p>Turn off to save the original file at its actual size. Applies to new images and saves in this browser.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
