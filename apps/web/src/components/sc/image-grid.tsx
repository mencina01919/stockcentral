'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  // Ordered list of image URLs. The first one is treated as the "main".
  urls: string[]
  // Called with the new ordered list whenever the user reorders or removes
  // an image.
  onChange: (next: string[]) => void
  // Visual size of each cell. Defaults to 96 (matches the redesign tokens).
  cellSize?: number
  // Cap how many cells render. The rest stay in `urls` but aren't drawn.
  maxVisible?: number
  // Disable interactions (e.g. while a save mutation is in flight).
  disabled?: boolean
}

// Sortable image grid — HTML5 native drag & drop, no extra deps.
// - Drag any tile to a new position; the array is reordered live.
// - The first tile gets the "PRINCIPAL" badge.
// - Each tile has a small ✕ to remove without going to the textarea.
export function ImageGrid({ urls, onChange, cellSize = 96, maxVisible = 8, disabled }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  if (urls.length === 0) return null

  const visible = urls.slice(0, maxVisible)

  const reorder = (from: number, to: number) => {
    if (from === to) return
    const next = urls.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  const remove = (i: number) => {
    const next = urls.slice()
    next.splice(i, 1)
    onChange(next)
  }

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cellSize}px, 1fr))` }}
    >
      {visible.map((url, i) => {
        const isDragging = dragIndex === i
        const isTarget = hoverIndex === i && dragIndex !== null && dragIndex !== i
        return (
          <div
            key={`${url}-${i}`}
            draggable={!disabled}
            onDragStart={(e) => {
              setDragIndex(i)
              e.dataTransfer.effectAllowed = 'move'
              // Required for Firefox to fire drag events.
              e.dataTransfer.setData('text/plain', String(i))
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (hoverIndex !== i) setHoverIndex(i)
            }}
            onDragLeave={() => {
              if (hoverIndex === i) setHoverIndex(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const from = dragIndex ?? Number(e.dataTransfer.getData('text/plain'))
              if (Number.isFinite(from)) reorder(from, i)
              setDragIndex(null)
              setHoverIndex(null)
            }}
            onDragEnd={() => {
              setDragIndex(null)
              setHoverIndex(null)
            }}
            className="relative overflow-hidden group"
            style={{
              aspectRatio: '1',
              borderRadius: 10,
              border: isTarget
                ? '2px solid var(--sc-blue-500)'
                : '1px solid var(--sc-line-soft)',
              background: '#f7f9fd',
              opacity: isDragging ? 0.4 : 1,
              cursor: disabled ? 'default' : 'grab',
              transition: 'border-color .15s, opacity .15s, transform .15s',
              transform: isTarget ? 'scale(1.03)' : 'none',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Imagen ${i + 1}`}
              draggable={false}
              className="w-full h-full object-cover pointer-events-none"
              onError={(e) => {
                ;(e.target as HTMLImageElement).parentElement!.style.display = 'none'
              }}
            />

            {/* Position badge */}
            <span
              className="sc-mono"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                fontSize: 9,
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(4px)',
                color: 'var(--sc-text-mid)',
                padding: '2px 6px',
                borderRadius: 4,
                letterSpacing: '0.1em',
                border: '1px solid var(--sc-line-soft)',
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>

            {/* Main badge on first */}
            {i === 0 && (
              <span
                className="sc-mono"
                style={{
                  position: 'absolute',
                  bottom: 4,
                  left: 4,
                  fontSize: 9,
                  background: 'var(--sc-blue-600)',
                  color: '#fff',
                  padding: '2px 6px',
                  borderRadius: 4,
                  letterSpacing: '0.1em',
                }}
              >
                PRINCIPAL
              </span>
            )}

            {/* Remove button — only on hover */}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(i)
                }}
                aria-label="Eliminar imagen"
                className="opacity-0 group-hover:opacity-100"
                style={{
                  position: 'absolute',
                  top: 4,
                  left: 4,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: 'rgba(220,38,38,0.92)',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'opacity .15s',
                }}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
