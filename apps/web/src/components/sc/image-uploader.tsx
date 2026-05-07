'use client'

import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'

interface UploadResult {
  url: string
  filename: string
  hash: string
  bytes: number
  width: number
  height: number
}

interface Props {
  // Called once per file after a successful upload, with the public URL
  // returned by the API (e.g. https://media.eylstore.cl/media/<hash>.jpg).
  onUploaded: (url: string) => void
  // Disable while parent is saving the form, etc.
  disabled?: boolean
  // Optional override for the button label.
  label?: string
}

export function ImageUploader({ onUploaded, disabled, label }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const open = () => {
    if (busy || disabled) return
    inputRef.current?.click()
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setProgress({ done: 0, total: files.length })
    let okCount = 0
    let errCount = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await api.post<UploadResult>('/media/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        onUploaded(res.data.url)
        okCount++
      } catch (err: any) {
        errCount++
        toast.error(
          `${file.name}: ${err?.response?.data?.message || 'Error al subir'}`,
        )
      }
      setProgress({ done: i + 1, total: files.length })
    }
    setBusy(false)
    setProgress(null)
    if (okCount && !errCount) toast.success(`${okCount} imagen${okCount > 1 ? 'es subidas' : ' subida'}`)
    else if (okCount && errCount) toast.warning(`${okCount} OK · ${errCount} con error`)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={open}
        disabled={busy || disabled}
        className="sc-btn-ghost"
        style={{
          padding: '8px 12px',
          fontSize: 12,
          color: 'var(--sc-blue-700)',
          borderColor: 'rgba(59,130,246,0.30)',
        }}
      >
        {busy ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {progress ? `Subiendo ${progress.done}/${progress.total}…` : 'Subiendo…'}
          </>
        ) : (
          <>
            <Upload className="w-3.5 h-3.5" />
            {label || 'Subir imágenes'}
          </>
        )}
      </button>
    </>
  )
}
