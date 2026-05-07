'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/* StockCentral redesign — shared UI primitives.
   Light blue-tech look with mono accents and subtle elevation. */

export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('sc-panel', className)} {...props}>
      {children}
    </div>
  )
}

export function MonoLabel({
  children,
  tone = 'low',
  className,
  ...props
}: {
  tone?: 'low' | 'blue' | 'warn' | 'err' | 'ok'
  children: React.ReactNode
} & React.HTMLAttributes<HTMLSpanElement>) {
  const color =
    tone === 'blue'
      ? 'var(--sc-blue-600)'
      : tone === 'warn'
      ? 'var(--sc-warn)'
      : tone === 'err'
      ? 'var(--sc-err)'
      : tone === 'ok'
      ? 'var(--sc-ok)'
      : 'var(--sc-text-low)'
  return (
    <span
      className={cn('sc-mono uppercase', className)}
      style={{ fontSize: 11, letterSpacing: '0.2em', color }}
      {...props}
    >
      {children}
    </span>
  )
}

export function SectionTitle({
  kicker,
  title,
  subtitle,
  right,
}: {
  kicker?: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="min-w-0">
        {kicker && <MonoLabel tone="blue">{kicker}</MonoLabel>}
        <h3
          className="mt-1"
          style={{
            fontSize: 18,
            fontWeight: 600,
            margin: 0,
            color: 'var(--sc-text-hi)',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <p style={{ fontSize: 13, color: 'var(--sc-text-mid)', margin: '4px 0 0' }}>{subtitle}</p>
        )}
      </div>
      {right}
    </div>
  )
}

export function Chip({
  children,
  tone = 'blue',
  dot = false,
  className,
  ...props
}: {
  tone?: 'blue' | 'ok' | 'warn' | 'err' | 'low' | 'cyan'
  dot?: boolean
  children: React.ReactNode
} & React.HTMLAttributes<HTMLSpanElement>) {
  const tones: Record<string, { color: string; bg: string; border: string }> = {
    blue: {
      color: 'var(--sc-blue-700)',
      bg: 'rgba(59,130,246,0.06)',
      border: 'rgba(59,130,246,0.20)',
    },
    ok: {
      color: 'var(--sc-ok)',
      bg: 'rgba(16,185,129,0.10)',
      border: 'rgba(16,185,129,0.25)',
    },
    warn: {
      color: 'var(--sc-warn)',
      bg: 'rgba(217,119,6,0.10)',
      border: 'rgba(217,119,6,0.25)',
    },
    err: {
      color: 'var(--sc-err)',
      bg: 'rgba(220,38,38,0.08)',
      border: 'rgba(220,38,38,0.25)',
    },
    low: {
      color: 'var(--sc-text-mid)',
      bg: 'rgba(30,58,138,0.05)',
      border: 'var(--sc-line-soft)',
    },
    cyan: {
      color: '#0891b2',
      bg: 'rgba(34,211,238,0.10)',
      border: 'rgba(34,211,238,0.25)',
    },
  }
  const t = tones[tone]
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 sc-mono', className)}
      style={{
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 10,
        letterSpacing: '0.1em',
        color: t.color,
        background: t.bg,
        border: `1px solid ${t.border}`,
      }}
      {...props}
    >
      {dot && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: t.color,
          }}
        />
      )}
      {children}
    </span>
  )
}

export function StatTile({
  label,
  kpi,
  value,
  delta,
  prefix = '',
  suffix = '',
  accent,
}: {
  label: string
  kpi?: string
  value: React.ReactNode
  delta?: number
  prefix?: string
  suffix?: string
  accent?: string
}) {
  return (
    <Panel
      className="relative overflow-hidden"
      style={{ padding: 20 }}
    >
      {accent && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: accent,
          }}
        />
      )}
      <div className="flex items-start justify-between mb-3">
        <div>
          <MonoLabel>{label}</MonoLabel>
          {kpi && (
            <div
              className="sc-mono"
              style={{ fontSize: 9, color: 'var(--sc-text-faint)', marginTop: 3, letterSpacing: '0.18em' }}
            >
              {kpi}
            </div>
          )}
        </div>
        {delta !== undefined && (
          <div
            className="sc-mono inline-flex items-center gap-1"
            style={{
              fontSize: 11,
              color: delta >= 0 ? 'var(--sc-ok)' : 'var(--sc-err)',
              padding: '3px 8px',
              borderRadius: 6,
              background:
                delta >= 0 ? 'rgba(16,185,129,0.10)' : 'rgba(220,38,38,0.08)',
              border: `1px solid ${
                delta >= 0 ? 'rgba(16,185,129,0.25)' : 'rgba(220,38,38,0.25)'
              }`,
            }}
          >
            {delta >= 0 ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
            {Math.abs(delta).toFixed(1)}%
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: 'var(--sc-text-hi)',
          fontFeatureSettings: '"tnum"',
          lineHeight: 1.05,
        }}
      >
        {prefix}
        {value}
        {suffix}
      </div>
    </Panel>
  )
}

/* Big mono-styled status pill suitable for table cells. */
export function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'ok' | 'warn' | 'err' | 'blue' | 'low' | 'cyan'
}) {
  return <Chip tone={tone}>{children}</Chip>
}

/* Sparkline used by stat tiles. */
export function Sparkline({
  points,
  color = '#3b82f6',
  height = 36,
}: {
  points: number[]
  color?: string
  height?: number
}) {
  const w = 200
  if (!points.length) return null
  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w
      const y = height - ((p - min) / range) * (height - 4) - 2
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
  const fillPath = `${path} L ${w} ${height} L 0 ${height} Z`
  const id = `sg-${color.replace('#', '')}`
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.4" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${id})`} />
      <path d={path} stroke={color} strokeWidth="1.6" fill="none" />
    </svg>
  )
}

/* Progress bar (used in plan-usage / stock-low / capacity widgets). */
export function ProgressBar({
  value,
  tone = 'blue',
  height = 6,
}: {
  value: number // 0-100
  tone?: 'blue' | 'warn' | 'err' | 'ok'
  height?: number
}) {
  const tones: Record<string, string> = {
    blue: 'linear-gradient(90deg, var(--sc-blue-600), var(--sc-blue-400))',
    warn: 'linear-gradient(90deg, #d97706, #f59e0b)',
    err: 'linear-gradient(90deg, #dc2626, #ef4444)',
    ok: 'linear-gradient(90deg, #10b981, #34d399)',
  }
  return (
    <div
      style={{
        height,
        borderRadius: height / 2,
        background: '#eef2f9',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: tones[tone],
          borderRadius: height / 2,
          transition: 'width .8s cubic-bezier(.2,.8,.2,1)',
        }}
      />
    </div>
  )
}

/* Toggle switch matching the design. */
export function Toggle({ checked, onChange }: { checked: boolean; onChange?: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange?.(!checked)}
      aria-pressed={checked}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        background: checked ? 'var(--sc-blue-600)' : '#e2e8f0',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background .2s',
        border: 'none',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
          transition: 'left .2s',
        }}
      />
    </button>
  )
}

export const SC_BLUE = {
  50: '#eff6ff',
  100: '#dbeafe',
  200: '#bfdbfe',
  300: '#93c5fd',
  400: '#60a5fa',
  500: '#3b82f6',
  600: '#2563eb',
  700: '#1d4ed8',
  800: '#1e40af',
  900: '#1e3a8a',
  cyan400: '#22d3ee',
  cyan500: '#06b6d4',
}
