"use client"

import { useEffect, useState } from 'react'

export default function ProductThumbnail({
  imageFile,
  imageUrl,
  alt,
  size = 80
}: {
  imageFile: File | null
  imageUrl: string | null
  alt: string
  size?: number
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!imageFile) {
      setObjectUrl(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const src = objectUrl || imageUrl

  if (!src) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-md flex items-center justify-center text-xs shrink-0 bg-[var(--placeholder-bg)] text-[var(--muted-text)]"
      >
        No image
      </div>
    )
  }

  return (
    // next/image can't load blob: URLs, so a plain <img> is required for uploaded-file previews
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} style={{ width: size, height: size }} className="object-cover rounded-md shrink-0" />
  )
}
