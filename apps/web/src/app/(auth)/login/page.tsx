'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth.store'
import { ChevronRight, Eye, Loader2, Lock, Mail } from 'lucide-react'

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
})

type LoginForm = z.infer<typeof schema>

function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M16 2L29 9.5V22.5L16 30L3 22.5V9.5L16 2Z" stroke="url(#sc-login-grad)" strokeWidth="1.6" />
      <path d="M16 9L22 12.5V19.5L16 23L10 19.5V12.5L16 9Z" stroke="url(#sc-login-grad)" strokeWidth="1.6" />
      <defs>
        <linearGradient id="sc-login-grad" x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60A5FA" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const { login, isLoading } = useAuthStore()
  const [serverError, setServerError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: LoginForm) => {
    try {
      setServerError('')
      await login(data.email, data.password)
      toast.success('Bienvenido a StockCentral')
      router.push('/dashboard')
    } catch (err: any) {
      setServerError(err?.response?.data?.message || 'Credenciales inválidas')
    }
  }

  return (
    <div
      className="sc-grid-bg relative overflow-hidden"
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: '1.1fr 1fr',
        background: 'linear-gradient(135deg, #f4f7fc 0%, #e8effa 60%, #dbe7fa 100%)',
      }}
    >
      <div className="sc-scan-line" style={{ top: 0 }} />

      {/* Left: hero */}
      <div
        className="hidden lg:flex flex-col justify-between relative"
        style={{ padding: '56px 64px' }}
      >
        <div className="flex items-center gap-3.5">
          <BrandMark />
          <div>
            <div
              className="sc-mono"
              style={{ fontSize: 18, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--sc-text-hi)' }}
            >
              STOCK<span style={{ color: 'var(--sc-blue-400)' }}>CENTRAL</span>
            </div>
            <div
              className="sc-mono"
              style={{ fontSize: 11, color: 'var(--sc-text-low)', letterSpacing: '0.18em', marginTop: 2 }}
            >
              OMNICHANNEL · COMMAND
            </div>
          </div>
        </div>

        <div>
          <div
            className="sc-mono"
            style={{
              fontSize: 11,
              color: 'var(--sc-blue-600)',
              letterSpacing: '0.2em',
              marginBottom: 18,
            }}
          >
            // PLATAFORMA OMNICANAL
          </div>
          <h2
            style={{
              fontSize: 56,
              lineHeight: 1.05,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              margin: 0,
              color: 'var(--sc-text-hi)',
            }}
          >
            Una sola consola
            <br />
            para{' '}
            <span
              style={{
                background: 'linear-gradient(90deg, #60a5fa, #22d3ee)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              vender
            </span>{' '}
            en
            <br />
            todos los canales.
          </h2>
          <p
            style={{
              fontSize: 15,
              color: 'var(--sc-text-mid)',
              maxWidth: 480,
              lineHeight: 1.6,
              marginTop: 24,
            }}
          >
            Sincronización en tiempo real entre tu tienda, marketplaces y bodegas. Una sola fuente de verdad para tu inventario.
          </p>
        </div>

        <div
          className="flex gap-9"
          style={{
            color: 'var(--sc-text-low)',
            fontSize: 11,
            letterSpacing: '0.14em',
          }}
        >
          <div className="sc-mono">
            <div style={{ color: 'var(--sc-text-hi)', fontSize: 24, fontWeight: 600, fontFamily: 'inherit' }}>
              7+
            </div>
            CANALES
          </div>
          <div className="sc-mono">
            <div style={{ color: 'var(--sc-text-hi)', fontSize: 24, fontWeight: 600, fontFamily: 'inherit' }}>
              99.9%
            </div>
            UPTIME
          </div>
          <div className="sc-mono">
            <div style={{ color: 'var(--sc-text-hi)', fontSize: 24, fontWeight: 600, fontFamily: 'inherit' }}>
              &lt;200ms
            </div>
            SYNC
          </div>
        </div>

        <svg
          aria-hidden
          style={{
            position: 'absolute',
            right: -100,
            top: '50%',
            transform: 'translateY(-50%)',
            opacity: 0.35,
            pointerEvents: 'none',
          }}
          width="500"
          height="500"
          viewBox="0 0 500 500"
          fill="none"
        >
          <circle cx="250" cy="250" r="120" stroke="#3b82f6" strokeWidth="1" strokeDasharray="2 4" />
          <circle cx="250" cy="250" r="180" stroke="#3b82f6" strokeWidth="1" strokeDasharray="2 6" />
          <circle cx="250" cy="250" r="240" stroke="#3b82f6" strokeWidth="1" strokeDasharray="2 8" />
          <circle cx="370" cy="250" r="6" fill="#60a5fa" />
          <circle cx="250" cy="70" r="4" fill="#22d3ee" />
          <circle cx="430" cy="190" r="5" fill="#60a5fa" />
        </svg>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center relative col-span-2 lg:col-span-1" style={{ padding: 32 }}>
        <div className="sc-panel relative w-full" style={{ maxWidth: 440, padding: 40 }}>
          <div
            style={{
              position: 'absolute',
              top: -1,
              left: 24,
              right: 24,
              height: 1,
              background: 'linear-gradient(90deg, transparent, var(--sc-blue-400), transparent)',
            }}
          />

          {/* Mobile brand */}
          <div className="flex items-center gap-3 mb-6 lg:hidden">
            <BrandMark size={32} />
            <div>
              <div
                className="sc-mono"
                style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--sc-text-hi)' }}
              >
                STOCK<span style={{ color: 'var(--sc-blue-600)' }}>CENTRAL</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center mb-8">
            <div>
              <div
                className="sc-mono"
                style={{ fontSize: 11, color: 'var(--sc-blue-600)', letterSpacing: '0.2em' }}
              >
                // AUTH.LOGIN
              </div>
              <h3
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  margin: '8px 0 0',
                  letterSpacing: '-0.01em',
                  color: 'var(--sc-text-hi)',
                }}
              >
                Iniciar sesión
              </h3>
            </div>
            <span className="sc-chip">
              <span className="sc-pulse-dot" />
              SSL
            </span>
          </div>

          {serverError && (
            <div
              className="mb-4"
              style={{
                background: 'rgba(220,38,38,0.06)',
                border: '1px solid rgba(220,38,38,0.25)',
                color: 'var(--sc-err)',
                fontSize: 13,
                borderRadius: 8,
                padding: '10px 12px',
              }}
            >
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div>
              <label
                className="sc-mono uppercase block mb-2"
                style={{ fontSize: 11, color: 'var(--sc-text-low)', letterSpacing: '0.16em' }}
              >
                Email
              </label>
              <div className="relative">
                <Mail
                  className="w-3.5 h-3.5 absolute"
                  style={{ left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--sc-text-low)' }}
                />
                <input
                  {...register('email')}
                  type="email"
                  placeholder="admin@tutienda.com"
                  className="sc-input"
                  style={{ paddingLeft: 38 }}
                />
              </div>
              {errors.email && (
                <p style={{ color: 'var(--sc-err)', fontSize: 12, marginTop: 4 }}>{errors.email.message}</p>
              )}
            </div>

            <div>
              <label
                className="sc-mono uppercase block mb-2"
                style={{ fontSize: 11, color: 'var(--sc-text-low)', letterSpacing: '0.16em' }}
              >
                Contraseña
              </label>
              <div className="relative">
                <Lock
                  className="w-3.5 h-3.5 absolute"
                  style={{ left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--sc-text-low)' }}
                />
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="sc-input"
                  style={{ paddingLeft: 38, paddingRight: 38 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label="Mostrar contraseña"
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--sc-text-low)',
                    padding: 4,
                  }}
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>
              {errors.password && (
                <p style={{ color: 'var(--sc-err)', fontSize: 12, marginTop: 4 }}>{errors.password.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="sc-btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: 14, fontSize: 14, marginTop: 8 }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Ingresando…
                </>
              ) : (
                <>
                  <span>Acceder al panel</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <p
            className="text-center mt-6"
            style={{ fontSize: 13, color: 'var(--sc-text-mid)' }}
          >
            ¿No tienes cuenta?{' '}
            <a href="/register" style={{ color: 'var(--sc-blue-600)', fontWeight: 500, textDecoration: 'none' }}>
              Regístrate gratis
            </a>
          </p>

        </div>
      </div>
    </div>
  )
}
