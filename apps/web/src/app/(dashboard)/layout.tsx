'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { useAuthStore } from '@/stores/auth.store'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated && !localStorage.getItem('accessToken')) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  return (
    <div className="flex h-screen sc-grid-bg">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
        <div className="sc-glow" />
        <div className="flex-1 overflow-auto relative" style={{ zIndex: 1 }}>
          {children}
        </div>
      </main>
    </div>
  )
}
