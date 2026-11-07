import React, { useEffect, useState } from 'react'
export default function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return <img src={url} alt={file.name}/>
}
