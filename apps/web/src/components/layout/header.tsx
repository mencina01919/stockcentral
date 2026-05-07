'use client'

import { Bell, Search } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'

interface HeaderProps {
  title: string
  subtitle?: string
  breadcrumbs?: string[]
  actions?: React.ReactNode
}

export function Header({ title, subtitle, breadcrumbs, actions }: HeaderProps) {
  const { user } = useAuthStore()
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase()

  return (
    <header
      className="flex items-center justify-between flex-shrink-0"
      style={{
        borderBottom: '1px solid var(--sc-line-soft)',
        padding: '18px 28px',
        background: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div
            className="sc-mono uppercase"
            style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              color: 'var(--sc-text-low)',
              marginBottom: 6,
            }}
          >
            {breadcrumbs.map((b, i) => (
              <span key={i}>
                <span style={{ color: i === breadcrumbs.length - 1 ? 'var(--sc-blue-600)' : 'var(--sc-text-low)' }}>
                  {b}
                </span>
                {i < breadcrumbs.length - 1 && (
                  <span style={{ margin: '0 8px', color: 'var(--sc-text-faint)' }}>/</span>
                )}
              </span>
            ))}
          </div>
        )}
        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            margin: 0,
            color: 'var(--sc-text-hi)',
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: 13, color: 'var(--sc-text-mid)', margin: '4px 0 0' }}>{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {actions}
        <div
          className="hidden md:flex items-center gap-2.5"
          style={{
            padding: '7px 14px 7px 12px',
            border: '1px solid var(--sc-line-soft)',
            borderRadius: 8,
            background: '#ffffff',
            minWidth: 240,
          }}
        >
          <Search className="w-3.5 h-3.5" style={{ color: 'var(--sc-text-low)' }} />
          <span style={{ fontSize: 13, color: 'var(--sc-text-faint)', flex: 1 }}>
            Buscar producto, orden, SKU…
          </span>
          <span
            className="sc-mono"
            style={{
              fontSize: 10,
              color: 'var(--sc-text-faint)',
              padding: '2px 6px',
              border: '1px solid var(--sc-line-soft)',
              borderRadius: 4,
            }}
          >
            ⌘K
          </span>
        </div>
        <button
          type="button"
          className="sc-btn-ghost relative"
          style={{ padding: '9px 11px' }}
          aria-label="Notificaciones"
        >
          <Bell className="w-[15px] h-[15px]" />
          <span
            style={{
              position: 'absolute',
              top: 7,
              right: 8,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--sc-err)',
            }}
          />
        </button>
        {user && (
          <div
            className="flex items-center justify-center text-white sc-mono"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #3b82f6, #1e3a8a)',
              fontSize: 11,
              fontWeight: 700,
              border: '1px solid var(--sc-line-strong)',
            }}
          >
            {initials || 'SC'}
          </div>
        )}
      </div>
    </header>
  )
}
