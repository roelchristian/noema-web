export function imageDimensions(width: number, height: number) {
  const scale = Math.min(1, 2560 / Math.max(width, height));
  return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale))};
}

// Keep animations intact; rasterize static images only. Fall back to the original
// when decoding/encoding is unsupported or compression would increase file size.
export async function compressImage(file: File): Promise<File> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return file;
  if (file.type === 'image/png') {
    // APNG declares animation before its first image-data chunk.
    for(let offset=8; offset+8 <= file.size;) {
      const chunk=new Uint8Array(await file.slice(offset,offset+8).arrayBuffer());
      const type=String.fromCharCode(...chunk.slice(4,8));
      if(type === 'acTL') return file;
      if(type === 'IDAT' || type === 'IEND') break;
      const length=new DataView(chunk.buffer).getUint32(0);
      offset+=length+12;
    }
  }
  if (file.type === 'image/webp') {
    const header = new Uint8Array(await file.slice(0,21).arrayBuffer());
    if (String.fromCharCode(...header.slice(12,16)) === 'VP8X' && (header[20]! & 2)) return file;
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const {width, height} = imageDimensions(image.naturalWidth,image.naturalHeight);
    const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
    const context=canvas.getContext('2d'); if(!context) return file;
    context.drawImage(image,0,0,width,height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,'image/webp',0.82));
    if(!blob || blob.size >= file.size) return file;
    return new File([blob],file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.png'),{type:blob.type});
  } catch { return file; }
  finally { URL.revokeObjectURL(url); }
}
