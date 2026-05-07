'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, Package, ShoppingCart, Warehouse, Plug, BarChart3,
  Settings, LogOut, Webhook, Receipt, ChevronDown, ChevronRight,
  Store, RefreshCw,
} from 'lucide-react'
import api from '@/lib/api'
import { cn, PROVIDER_LABELS } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

type NavLeaf = { type: 'leaf'; href: string; label: string }
type NavGroup = {
  type: 'group'
  key: string
  label: string
  icon: any
  basePath: string
  items: NavLeaf[]
}
type NavItem = { type: 'leaf'; href: string; label: string; icon: any } | NavGroup

function BrandMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M16 2L29 9.5V22.5L16 30L3 22.5V9.5L16 2Z" stroke="url(#sc-brand-grad)" strokeWidth="1.6" />
      <path d="M16 9L22 12.5V19.5L16 23L10 19.5V12.5L16 9Z" fill="url(#sc-brand-grad)" />
      <defs>
        <linearGradient id="sc-brand-grad" x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60A5FA" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuthStore()

  const { data: connections } = useQuery<any[]>({
    queryKey: ['connections'],
    queryFn: () => api.get('/connections').then((r) => r.data),
    staleTime: 60_000,
  })
  const providers: string[] = (connections || [])
    .filter((c: any) => c.status === 'connected' || c.status === 'disconnected')
    .map((c: any) => c.provider)
  const uniqueProviders = Array.from(new Set(providers))

  const channelLeaves = (basePath: string): NavLeaf[] => [
    { type: 'leaf', href: `${basePath}/all`, label: 'Todas' },
    ...uniqueProviders.map((p) => ({
      type: 'leaf' as const,
      href: `${basePath}/${p}`,
      label: PROVIDER_LABELS[p] || p,
    })),
  ]

  const productsLeaves: NavLeaf[] = [
    { type: 'leaf', href: '/products/master', label: 'Maestro' },
    ...uniqueProviders.map((p) => ({
      type: 'leaf' as const,
      href: `/products/${p}`,
      label: PROVIDER_LABELS[p] || p,
    })),
  ]

  const navItems: NavItem[] = [
    { type: 'leaf', href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    {
      type: 'group',
      key: 'products',
      label: 'Productos',
      icon: Package,
      basePath: '/products',
      items: productsLeaves,
    },
    {
      type: 'group',
      key: 'orders',
      label: 'Órdenes',
      icon: ShoppingCart,
      basePath: '/orders',
      items: channelLeaves('/orders'),
    },
    {
      type: 'group',
      key: 'sales',
      label: 'Facturación',
      icon: Receipt,
      basePath: '/sales',
      items: [
        { type: 'leaf', href: '/billing/documents', label: 'Documentos' },
        { type: 'leaf', href: '/billing/setup', label: 'Configuración' },
        ...channelLeaves('/sales'),
      ],
    },
    { type: 'leaf', href: '/inventory', label: 'Inventario', icon: Warehouse },
    { type: 'leaf', href: '/warehouses', label: 'Bodegas', icon: Store },
    { type: 'leaf', href: '/publications', label: 'Publicaciones', icon: Package },
    { type: 'leaf', href: '/stock-sync', label: 'Sync de Stock', icon: RefreshCw },
    { type: 'leaf', href: '/connections', label: 'Conexiones', icon: Plug },
    { type: 'leaf', href: '/reports', label: 'Reportes', icon: BarChart3 },
    { type: 'leaf', href: '/webhooks', label: 'Webhooks', icon: Webhook },
  ]

  const tenantInitials = (user?.tenant?.name || 'SC').slice(0, 2).toUpperCase()
  const userInitials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase()

  return (
    <aside className="sc-side">
      {/* Brand */}
      <div className="px-[18px] py-5" style={{ borderBottom: '1px solid var(--sc-line-soft)' }}>
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <div
              className="sc-mono"
              style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--sc-text-hi)' }}
            >
              STOCK<span style={{ color: 'var(--sc-blue-600)' }}>CENTRAL</span>
            </div>
            <div
              className="sc-mono"
              style={{ fontSize: 10, color: 'var(--sc-text-low)', letterSpacing: '0.18em', marginTop: 2 }}
            >
              v2.4.0 · OMNICANAL
            </div>
          </div>
        </div>
      </div>

      {/* Tenant chip */}
      <div className="px-[18px] pt-[14px] pb-[10px]">
        <div
          className="sc-panel-flat flex items-center gap-2.5"
          style={{ padding: '10px 12px', background: 'rgba(59,130,246,0.05)' }}
        >
          <div
            className="flex items-center justify-center sc-mono text-white"
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: 'linear-gradient(135deg, #3b82f6, #1e3a8a)',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {tenantInitials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--sc-text-hi)' }}>
              {user?.tenant?.name || 'Mi Tienda'}
            </div>
            <div className="sc-mono text-[10px]" style={{ color: 'var(--sc-text-low)' }}>
              {user?.tenant?.currency || 'CLP'}
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto sc-scroll-hide" style={{ padding: '8px 12px' }}>
        <div
          className="sc-mono"
          style={{ padding: '8px 8px 6px', fontSize: 10, letterSpacing: '0.2em', color: 'var(--sc-text-faint)' }}
        >
          NAVEGACIÓN
        </div>
        {navItems.map((item) => {
          if (item.type === 'leaf') {
            const Icon = item.icon
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            const isLive = item.href === '/stock-sync'
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn('sc-nav-item', active && 'is-active')}
              >
                <Icon
                  className="w-[15px] h-[15px] flex-shrink-0"
                  style={{ color: active ? 'var(--sc-blue-600)' : 'var(--sc-text-mid)' }}
                />
                <span className="flex-1">{item.label}</span>
                {isLive && (
                  <span
                    className="sc-mono"
                    style={{
                      fontSize: 9,
                      color: 'var(--sc-ok)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'rgba(16,185,129,0.10)',
                      border: '1px solid rgba(16,185,129,0.25)',
                    }}
                  >
                    LIVE
                  </span>
                )}
              </Link>
            )
          }
          return <SidebarGroup key={item.key} group={item} pathname={pathname} />
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3" style={{ borderTop: '1px solid var(--sc-line-soft)' }}>
        <Link href="/settings" className="sc-nav-item">
          <Settings className="w-[15px] h-[15px]" style={{ color: 'var(--sc-text-mid)' }} />
          <span>Configuración</span>
        </Link>
        <button onClick={logout} className="sc-nav-item w-full text-left" style={{ background: 'transparent' }}>
          <LogOut className="w-[15px] h-[15px]" style={{ color: 'var(--sc-text-mid)' }} />
          <span>Cerrar sesión</span>
        </button>

        {user && (
          <div className="flex items-center gap-2.5 mt-1.5" style={{ padding: '10px 12px' }}>
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
              {userInitials || 'SC'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--sc-text-hi)' }}>
                {user.firstName} {user.lastName}
              </div>
              <div className="sc-mono text-[10px] uppercase" style={{ color: 'var(--sc-text-low)' }}>
                {user.role} · ONLINE
              </div>
            </div>
            <span className="sc-pulse-dot" />
          </div>
        )}
      </div>
    </aside>
  )
}

function SidebarGroup({ group, pathname }: { group: NavGroup; pathname: string }) {
  // Un grupo está activo si la ruta cae bajo basePath O coincide con alguno
  // de sus leaves (algunos grupos tienen leaves fuera del basePath, p.ej.
  // Facturación apunta a /sales/* pero también incluye /billing/documents).
  const inGroup =
    pathname === group.basePath ||
    pathname.startsWith(group.basePath + '/') ||
    group.items.some((leaf) => pathname === leaf.href || pathname.startsWith(leaf.href + '/'))
  const [open, setOpen] = useState(inGroup)
  const Icon = group.icon

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn('sc-nav-item w-full text-left', inGroup && 'is-active')}
      >
        <Icon
          className="w-[15px] h-[15px] flex-shrink-0"
          style={{ color: inGroup ? 'var(--sc-blue-600)' : 'var(--sc-text-mid)' }}
        />
        <span className="flex-1">{group.label}</span>
        {open ? (
          <ChevronDown className="w-[13px] h-[13px]" style={{ color: 'var(--sc-text-low)' }} />
        ) : (
          <ChevronRight className="w-[13px] h-[13px]" style={{ color: 'var(--sc-text-low)' }} />
        )}
      </button>
      {open && (
        <div
          className="my-1"
          style={{ marginLeft: 14, paddingLeft: 14, borderLeft: '1px solid var(--sc-line-soft)' }}
        >
          {group.items.map((leaf) => {
            const active = pathname === leaf.href
            return (
              <Link
                key={leaf.href}
                href={leaf.href}
                className={cn('sc-nav-sub', active && 'is-active')}
              >
                {leaf.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
