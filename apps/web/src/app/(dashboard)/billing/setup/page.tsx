'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Check, AlertCircle, Save } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, MonoLabel } from '@/components/sc/ui'
import { toast } from 'sonner'

// Configuración del facturador electrónico Bsale por tenant. Almacena la
// conexión en la tabla `Connection` con provider='bsale'. Hoy es el único
// emisor; cuando se sumen Haulmer/OpenFactura, este formulario se
// generalizará con un selector de provider.

export default function BillingSetupPage() {
  const queryClient = useQueryClient()
  const [accessToken, setAccessToken] = useState('')
  const [officeId, setOfficeId] = useState('')
  const [taxIdIVA, setTaxIdIVA] = useState('')
  const [declareSii, setDeclareSii] = useState(true)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const { data: existing, isLoading } = useQuery({
    queryKey: ['connections', 'bsale'],
    queryFn: async () => {
      const res = await api.get('/connections')
      const list: any[] = Array.isArray(res.data) ? res.data : res.data?.data || []
      return list.find((c) => c.provider === 'bsale') || null
    },
  })

  // Hidratar el form con los valores actuales (sin exponer el token nunca).
  useEffect(() => {
    if (existing) {
      const cfg = (existing.config || {}) as any
      setOfficeId(cfg.officeId ? String(cfg.officeId) : '')
      setTaxIdIVA(cfg.taxIdIVA ? String(cfg.taxIdIVA) : '')
      // declareSii es true por default; solo lo desactivamos si vino explícito
      // como false/0.
      setDeclareSii(cfg.declareSii !== false && cfg.declareSii !== 0)
    }
  }, [existing])

  const save = useMutation({
    mutationFn: async () => {
      if (!taxIdIVA.trim()) {
        throw new Error(
          'Debes ingresar el ID del impuesto IVA. Sin esto, los documentos saldrían exentos.',
        )
      }
      const body = {
        type: 'billing',
        provider: 'bsale',
        name: 'Bsale',
        credentials: accessToken ? { accessToken } : undefined,
        config: { officeId, taxIdIVA, declareSii },
      }
      if (existing?.id) {
        // Si no se ingresó token nuevo, no sobreescribir credenciales (no las
        // queremos pisar con string vacío).
        const patch: any = { config: body.config, name: body.name }
        if (accessToken) patch.credentials = body.credentials
        return api.patch(`/connections/${existing.id}`, patch).then((r) => r.data)
      }
      if (!accessToken) {
        throw new Error('Token requerido para crear la conexión')
      }
      return api.post('/connections', body).then((r) => r.data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] })
      toast.success('Configuración guardada')
      setAccessToken('')
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message || err?.message || 'Error al guardar'),
  })

  const test = useMutation({
    mutationFn: () => api.post('/tax-documents/test-connection/bsale').then((r) => r.data),
    onSuccess: (data) => {
      if (data?.success) {
        setTestResult({
          success: true,
          message: `Conectado${data.accountName ? ` · ${data.accountName}` : ''}${
            data.officeId ? ` · office #${data.officeId}` : ''
          }`,
        })
      } else {
        setTestResult({ success: false, message: data?.error || 'Falló la conexión' })
      }
    },
    onError: (err: any) => {
      setTestResult({
        success: false,
        message: err?.response?.data?.message || err?.message || 'Error en test de conexión',
      })
    },
  })

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'FACTURACIÓN', 'CONFIGURACIÓN']}
        title="Configuración del facturador"
        subtitle="Conexión con Bsale para emitir boletas, facturas y notas de crédito"
      />

      <div className="flex-1 px-7 py-6 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
          </div>
        ) : (
          <Panel style={{ maxWidth: 640, padding: 24 }}>
            <MonoLabel tone="blue">// EMISOR.BSALE</MonoLabel>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--sc-text-hi)', marginTop: 4 }}>
              Bsale (Chile)
            </h2>
            <p style={{ fontSize: 13, color: 'var(--sc-text-low)', marginTop: 4, marginBottom: 18 }}>
              {existing
                ? 'Conexión configurada. Deja el token vacío para mantener el actual.'
                : 'Pega tu token de acceso Bsale y configura sucursal.'}
            </p>

            <div className="space-y-4">
              <Field label="Access token (Bsale)">
                <input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={existing ? '•••••••• (sin cambiar)' : 'pega tu token'}
                  className="sc-input"
                  autoComplete="off"
                />
                <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 4 }}>
                  Lo encuentras en Bsale → Configuración → API.
                </p>
              </Field>

              <Field label="Sucursal (officeId)">
                <input
                  value={officeId}
                  onChange={(e) => setOfficeId(e.target.value)}
                  placeholder="ej. 1"
                  className="sc-input"
                />
                <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 4 }}>
                  ID de la sucursal de emisión. Obligatorio.
                </p>
              </Field>

              <Field label="IVA — taxId (obligatorio)">
                <input
                  value={taxIdIVA}
                  onChange={(e) => setTaxIdIVA(e.target.value)}
                  placeholder="ej. 14"
                  className="sc-input"
                  required
                />
                <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 4 }}>
                  ID del impuesto IVA en TU cuenta Bsale. Sin esto, los DTE
                  saldrían exentos. Lo encuentras en Bsale → Configuración →
                  Impuestos.
                </p>
              </Field>

              <Field label="Declarar al SII">
                <label className="flex items-center gap-2 cursor-pointer" style={{ paddingTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={declareSii}
                    onChange={(e) => setDeclareSii(e.target.checked)}
                  />
                  <span style={{ fontSize: 13, color: 'var(--sc-text-mid)' }}>
                    {declareSii ? 'Sí — los documentos se envían al SII' : 'No — emisión sin declarar'}
                  </span>
                </label>
                <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 4 }}>
                  Desactívalo para sandbox o pruebas iniciales sin gastar
                  folios reales.
                </p>
              </Field>
            </div>

            <div
              className="sc-mono"
              style={{
                marginTop: 18,
                padding: 12,
                fontSize: 11,
                color: 'var(--sc-text-mid)',
                background: 'rgba(59,130,246,0.05)',
                borderRadius: 6,
                border: '1px solid rgba(59,130,246,0.15)',
                lineHeight: 1.6,
              }}
            >
              <strong style={{ color: 'var(--sc-blue-600)' }}>// SANDBOX</strong>
              <br />
              Bsale usa la misma URL <code>api.bsale.io</code> para sandbox y
              producción. La diferencia la determina el token: si te registras
              en <code>account.bsale.dev</code>, el token resultante actúa
              como sandbox. También puedes desactivar "Declarar al SII" arriba
              para emitir desde producción sin enviar al SII.
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="sc-btn-primary"
                style={{ padding: '10px 16px', fontSize: 13 }}
              >
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar
              </button>
              <button
                onClick={() => test.mutate()}
                disabled={test.isPending || !existing}
                className="sc-btn-ghost"
                style={{ padding: '10px 16px', fontSize: 13 }}
                title={!existing ? 'Guarda primero la conexión' : ''}
              >
                {test.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Probar conexión
              </button>
            </div>

            {testResult && (
              <div
                className="flex items-start gap-2 mt-4"
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: testResult.success ? 'rgba(16,185,129,0.06)' : 'rgba(220,38,38,0.06)',
                  border: testResult.success
                    ? '1px solid rgba(16,185,129,0.20)'
                    : '1px solid rgba(220,38,38,0.20)',
                }}
              >
                {testResult.success ? (
                  <Check className="w-4 h-4 mt-0.5" style={{ color: 'var(--sc-ok)' }} />
                ) : (
                  <AlertCircle className="w-4 h-4 mt-0.5" style={{ color: 'var(--sc-err)' }} />
                )}
                <div>
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: testResult.success ? 'var(--sc-ok)' : 'var(--sc-err)',
                    }}
                  >
                    {testResult.success ? 'Conexión OK' : 'No conectado'}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--sc-text-mid)', marginTop: 2 }}>
                    {testResult.message}
                  </p>
                </div>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        className="sc-mono uppercase block"
        style={{
          fontSize: 10,
          letterSpacing: '0.16em',
          color: 'var(--sc-text-low)',
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}
