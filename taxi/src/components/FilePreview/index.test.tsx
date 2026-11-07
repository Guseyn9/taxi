import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import FilePreview from './index'
it('creates one preview per file and releases each URL after replacement and unmount', async () => {
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL
  URL.createObjectURL = jest.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
  URL.revokeObjectURL = jest.fn()
  const host = document.createElement('div'), root = createRoot(host), first = new File(['a'],'a.png')
  try {
    await act(async()=>root.render(<FilePreview file={first}/>))
    await act(async()=>root.render(<FilePreview file={first}/>))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    await act(async()=>root.render(<FilePreview file={new File(['b'],'b.png')}/>))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
    await act(async()=>root.unmount())
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second')
  } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke }
})
