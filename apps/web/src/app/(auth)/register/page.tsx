'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { ChevronRight, Loader2 } from 'lucide-react'

const schema = z.object({
  firstName: z.string().min(2, 'Mínimo 2 caracteres'),
  lastName: z.string().min(2, 'Mínimo 2 caracteres'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  tenantName: z.string().min(3, 'Mínimo 3 caracteres'),
})

type RegisterForm = z.infer<typeof schema>

function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M16 2L29 9.5V22.5L16 30L3 22.5V9.5L16 2Z" stroke="url(#sc-reg-grad)" strokeWidth="1.6" />
      <path d="M16 9L22 12.5V19.5L16 23L10 19.5V12.5L16 9Z" fill="url(#sc-reg-grad)" />
      <defs>
        <linearGradient id="sc-reg-grad" x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60A5FA" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default function RegisterPage() {
  const router = useRouter()
  const { setUser } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [serverError, setServerError] = useState('')

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: RegisterForm) => {
    try {
      setLoading(true)
      setServerError('')
      const { data: authData } = await api.post('/auth/register', data)
      localStorage.setItem('accessToken', authData.accessToken)
      localStorage.setItem('refreshToken', authData.refreshToken)
      const meRes = await api.get('/auth/me')
      setUser(meRes.data)
      toast.success('¡Cuenta creada! Bienvenido a StockCentral')
      router.push('/dashboard')
    } catch (err: any) {
      setServerError(err?.response?.data?.message || 'Error al crear la cuenta')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="sc-grid-bg relative overflow-hidden flex items-center justify-center"
      style={{
        minHeight: '100vh',
        padding: 24,
        background: 'linear-gradient(135deg, #f4f7fc 0%, #e8effa 60%, #dbe7fa 100%)',
      }}
    >
      <div className="sc-scan-line" style={{ top: 0 }} />

      <div className="sc-panel relative w-full" style={{ maxWidth: 460, padding: 40 }}>
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

        <div className="flex items-center gap-3 mb-7">
          <BrandMark />
          <div>
            <div
              className="sc-mono"
              style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--sc-text-hi)' }}
            >
              STOCK<span style={{ color: 'var(--sc-blue-600)' }}>CENTRAL</span>
            </div>
            <div
              className="sc-mono"
              style={{ fontSize: 10, color: 'var(--sc-text-low)', letterSpacing: '0.18em', marginTop: 2 }}
            >
              PRUEBA · 14 DÍAS
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div
            className="sc-mono"
            style={{ fontSize: 11, color: 'var(--sc-blue-600)', letterSpacing: '0.2em' }}
          >
            // AUTH.SIGNUP
          </div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 600,
              margin: '8px 0 0',
              letterSpacing: '-0.01em',
              color: 'var(--sc-text-hi)',
            }}
          >
            Crear cuenta
          </h2>
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre" error={errors.firstName?.message}>
              <input {...register('firstName')} className="sc-input" />
            </Field>
            <Field label="Apellido" error={errors.lastName?.message}>
              <input {...register('lastName')} className="sc-input" />
            </Field>
          </div>

          <Field label="Empresa / Tienda" error={errors.tenantName?.message}>
            <input
              {...register('tenantName')}
              placeholder="Mi Tienda Online"
              className="sc-input"
            />
          </Field>

          <Field label="Email" error={errors.email?.message}>
            <input {...register('email')} type="email" className="sc-input" placeholder="tu@email.com" />
          </Field>

          <Field label="Contraseña" error={errors.password?.message}>
            <input
              {...register('password')}
              type="password"
              placeholder="Mínimo 8 caracteres"
              className="sc-input"
            />
          </Field>

          <button
            type="submit"
            disabled={loading}
            className="sc-btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: 14, fontSize: 14, marginTop: 4 }}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creando cuenta…
              </>
            ) : (
              <>
                <span>Crear cuenta gratis</span>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <p
          className="text-center mt-6"
          style={{ fontSize: 13, color: 'var(--sc-text-mid)' }}
        >
          ¿Ya tienes cuenta?{' '}
          <a href="/login" style={{ color: 'var(--sc-blue-600)', fontWeight: 500, textDecoration: 'none' }}>
            Inicia sesión
          </a>
        </p>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  error,
}: {
  label: string
  children: React.ReactNode
  error?: string
}) {
  return (
    <div>
      <label
        className="sc-mono uppercase block mb-2"
        style={{ fontSize: 11, color: 'var(--sc-text-low)', letterSpacing: '0.16em' }}
      >
        {label}
      </label>
      {children}
      {error && <p style={{ color: 'var(--sc-err)', fontSize: 12, marginTop: 4 }}>{error}</p>}
    </div>
  )
}
