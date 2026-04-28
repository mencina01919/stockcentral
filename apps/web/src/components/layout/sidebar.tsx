'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, Package, ShoppingCart, Warehouse, Plug, BarChart3,
  Settings, LogOut, Package2, Webhook, Receipt, ChevronDown, ChevronRight,
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

export function Sidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuthStore()

  const { data: connectionsData } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.get('/connections').then((r) => r.data),
    staleTime: 60_000,
  })
  const providers: string[] = (connectionsData?.data || [])
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
      key: 'sales',
      label: 'Ventas',
      icon: Receipt,
      basePath: '/sales',
      items: channelLeaves('/sales'),
    },
    {
      type: 'group',
      key: 'orders',
      label: 'Órdenes',
      icon: ShoppingCart,
      basePath: '/orders',
      items: channelLeaves('/orders'),
    },
    { type: 'leaf', href: '/inventory', label: 'Inventario', icon: Warehouse },
    { type: 'leaf', href: '/connections', label: 'Conexiones', icon: Plug },
    { type: 'leaf', href: '/reports', label: 'Reportes', icon: BarChart3 },
    { type: 'leaf', href: '/webhooks', label: 'Webhooks', icon: Webhook },
  ]

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col min-h-screen">
      <div className="p-5 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-sky-500 rounded-lg flex items-center justify-center">
            <Package2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm">StockCentral</p>
            <p className="text-xs text-gray-400 truncate max-w-[140px]">
              {user?.tenant?.name || 'Mi Tienda'}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          if (item.type === 'leaf') {
            const Icon = item.icon
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-sky-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white',
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </Link>
            )
          }
          return <SidebarGroup key={item.key} group={item} pathname={pathname} />
        })}
      </nav>

      <div className="p-4 border-t border-gray-700 space-y-1">
        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <Settings className="w-4 h-4" />
          Configuración
        </Link>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>

      {user && (
        <div className="p-4 border-t border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-sky-600 rounded-full flex items-center justify-center text-xs font-bold">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-gray-400 capitalize">{user.role}</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

function SidebarGroup({ group, pathname }: { group: NavGroup; pathname: string }) {
  const inGroup = pathname === group.basePath || pathname.startsWith(group.basePath + '/')
  const [open, setOpen] = useState(inGroup)
  const Icon = group.icon

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          inGroup
            ? 'bg-gray-800 text-white'
            : 'text-gray-300 hover:bg-gray-800 hover:text-white',
        )}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && (
        <div className="mt-1 ml-3 pl-4 border-l border-gray-700 space-y-0.5">
          {group.items.map((leaf) => {
            const active = pathname === leaf.href
            return (
              <Link
                key={leaf.href}
                href={leaf.href}
                className={cn(
                  'block px-3 py-2 rounded-md text-xs font-medium transition-colors',
                  active
                    ? 'bg-sky-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800',
                )}
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
