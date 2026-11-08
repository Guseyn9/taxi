import { MAX_IMAGE_BYTES, MAX_UPLOAD_FILES, rasterFileBase64, validateUploadBatch } from './fileUpload'
const png = () => new File([new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR0cAAAAASUVORK5CYII=', 'base64'))], 'photo.png', {type:'image/png'})
let bitmap: typeof createImageBitmap
beforeEach(() => { bitmap = globalThis.createImageBitmap;globalThis.createImageBitmap = jest.fn().mockResolvedValue({width:1,height:1,close:jest.fn()}) })
afterEach(() => { globalThis.createImageBitmap = bitmap })
it('accepts a bounded PNG and checks content before encoding', async () => {
  expect(await rasterFileBase64(png())).toMatch(/^data:image\/png;base64,/)
  await expect(rasterFileBase64(new File(['<svg onload="alert(1)">'],'spoof.png',{type:'image/png'}))).rejects.toThrow('content')
})
it('validates all files and rejects a bad second file, excessive count and oversized content before reads', async () => {
  expect(() => validateUploadBatch([png(),new File(['x'],'bad.html',{type:'text/html'})])).toThrow()
  expect(() => validateUploadBatch(Array.from({length:MAX_UPLOAD_FILES+1},png))).toThrow()
  const huge = new File([new Uint8Array(MAX_IMAGE_BYTES+1)],'huge.png',{type:'image/png'})
  await expect(rasterFileBase64(huge)).rejects.toThrow('8 MB')
  for (const [type, prefix] of [['image/jpeg',[255,216,255]],['image/png',[137,80,78,71,13,10,26,10]]] as const) {
    await expect(rasterFileBase64(new File([new Uint8Array(prefix),'<svg onload="alert(1)"></svg>'],'spoof',{type}))).rejects.toThrow()
  }
})
it('rejects decoder failures even if a file has a valid PNG header', async () => {
  ;(globalThis.createImageBitmap as any).mockRejectedValue(new Error('invalid image'))
  await expect(rasterFileBase64(png())).rejects.toThrow('invalid image')
})
