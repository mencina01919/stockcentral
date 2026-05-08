'use client'

import { useState, useRef, useEffect } from 'react'
import { DayPicker } from 'react-day-picker'
import { es } from 'date-fns/locale'
import { Calendar, X } from 'lucide-react'
import 'react-day-picker/dist/style.css'

// DatePicker con calendario popover. Display dd/mm/yyyy, valor interno ISO
// (yyyy-mm-dd) para que el backend reciba el formato estándar.
//
// Uso:
//   <DatePicker value={iso} onChange={setIso} placeholder="dd/mm/aaaa" />
export function DatePicker({
  value,
  onChange,
  placeholder = 'dd/mm/aaaa',
  className,
  style,
}: {
  value: string
  onChange: (isoDate: string) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  // Posición efectiva del popover, calculada al abrir para que no se salga
  // del viewport por la derecha (problema típico del campo "Hasta") o por
  // abajo (cuando el filtro está cerca del bottom de la pantalla).
  const [popoverPos, setPopoverPos] = useState<{
    horizontal: 'left' | 'right'
    vertical: 'bottom' | 'top'
  }>({ horizontal: 'left', vertical: 'bottom' })

  const selected = value ? parseIso(value) : undefined

  // Cerrar al click fuera.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Al abrir, decidir hacia qué lado se despliega el calendario.
  useEffect(() => {
    if (!open || !wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    const POPUP_WIDTH = 300
    const POPUP_HEIGHT = 360
    const margin = 8
    // Si no entra a la derecha del trigger, anclar al borde derecho del trigger.
    const horizontal: 'left' | 'right' =
      rect.left + POPUP_WIDTH + margin > window.innerWidth ? 'right' : 'left'
    // Si no entra abajo, abrir hacia arriba.
    const vertical: 'bottom' | 'top' =
      rect.bottom + POPUP_HEIGHT + margin > window.innerHeight && rect.top > POPUP_HEIGHT + margin
        ? 'top'
        : 'bottom'
    setPopoverPos({ horizontal, vertical })
  }, [open])

  return (
    <div ref={wrapperRef} className="relative inline-block" style={style}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          ...style,
        }}
      >
        <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--sc-text-low)', flexShrink: 0 }} />
        <span style={{ color: value ? 'var(--sc-text-hi)' : 'var(--sc-text-faint)', flex: 1 }}>
          {value ? toDisplay(value) : placeholder}
        </span>
        {value && (
          <span
            role="button"
            aria-label="Limpiar"
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            style={{
              color: 'var(--sc-text-low)',
              padding: 2,
              cursor: 'pointer',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <X className="w-3 h-3" />
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            ...(popoverPos.vertical === 'bottom'
              ? { top: 'calc(100% + 6px)' }
              : { bottom: 'calc(100% + 6px)' }),
            ...(popoverPos.horizontal === 'left' ? { left: 0 } : { right: 0 }),
            zIndex: 50,
            background: 'white',
            border: '1px solid var(--sc-line-soft)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(15,23,42,0.10)',
            padding: 8,
          }}
        >
          <DayPicker
            mode="single"
            locale={es}
            weekStartsOn={1}
            selected={selected}
            onSelect={(d) => {
              if (d) {
                onChange(toIso(d))
                setOpen(false)
              } else {
                onChange('')
              }
            }}
            captionLayout="dropdown"
            startMonth={new Date(2020, 0)}
            endMonth={new Date(new Date().getFullYear() + 1, 11)}
          />
        </div>
      )}
    </div>
  )
}

function parseIso(iso: string): Date | undefined {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? undefined : d
}

function toIso(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return `${m[3]}/${m[2]}/${m[1]}`
}
