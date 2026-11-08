import { assertSessionGeneration, sessionGeneration } from './sessionLifecycle'
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_UPLOAD_FILES = 6
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024
export function validateUploadBatch(files: File[]): void {
  if (files.length > MAX_UPLOAD_FILES || files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_TOTAL_BYTES) throw new Error('Upload limit: 6 images, 20 MB total')
  for (const file of files) {
    if (!(file instanceof Blob) || !['image/png', 'image/jpeg'].includes(file.type) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Choose PNG/JPEG images up to 8 MB each')
  }
}
function read(file: Blob, mode: 'readAsArrayBuffer' | 'readAsDataURL'): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read the image'))
    reader.onabort = () => reject(new Error('Image read cancelled'))
    reader[mode](file)
  })
}
function dimensions(bytes: Uint8Array, mime: string): [number, number] | null {
  if (mime === 'image/png') {
    if (bytes.length < 33 || ![137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].every((value, index) => bytes[index] === value)) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return [view.getUint32(16), view.getUint32(20)]
  }
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return null
  let offset = 2
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 255) return null
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 218 || marker === 217) return null
    const length = bytes[offset] * 256 + bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) return null
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return length >= 8 ? [bytes[offset + 5] * 256 + bytes[offset + 6], bytes[offset + 3] * 256 + bytes[offset + 4]] : null
    offset += length
  }
  return null
}
async function decodeRaster(file: File): Promise<void> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    try { if (!bitmap.width || !bitmap.height) throw new Error('Invalid image') }
    finally { bitmap.close() }
    return
  }
  await new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(file), image = new Image()
    const finish = (error?: Error) => { clearTimeout(timer);image.onload = image.onerror = null;URL.revokeObjectURL(url);error ? reject(error) : resolve() }
    const timer = setTimeout(() => finish(new Error('Image decoding timed out')), 10000)
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? undefined : new Error('Invalid image'))
    image.onerror = () => finish(new Error('Invalid image'))
    image.src = url
  })
}
/** Usability/content guard; authoritative decoding and private-file ACL remain server responsibilities. */
export async function rasterFileBase64(file: File): Promise<string> {
  const generation = sessionGeneration()
  validateUploadBatch([file])
  const bytes = new Uint8Array(await read(file, 'readAsArrayBuffer'))
  const size = dimensions(bytes, file.type)
  if (!size || size.some(value => value <= 0 || value > 8192) || size[0] * size[1] > 16_000_000) throw new Error('Image content or dimensions are invalid (maximum 16 megapixels)')
  await decodeRaster(file)
  const base64 = await read(file, 'readAsDataURL')
  assertSessionGeneration(generation)
  return base64
}
