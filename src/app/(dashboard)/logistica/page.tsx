'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Clipboard, Loader2, Package, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface TrackingEvent {
  date: string | null
  code: string | null
  status: string
  location: string | null
  detail: string | null
}

interface TrackingResult {
  code: string
  status: string
  statusCode: string | null
  events: TrackingEvent[]
}

interface OrderItem {
  date: string
  number: string
  customerName: string
  value: number
  customerId: string
  hasPhone: boolean
}

interface Shipment {
  id: string
  tracking_code: string
  os_date: string
  os_number: string
  customer_name: string
  order_value: number
  contact_id: string | null
  last_status_text: string | null
  last_event_at: string | null
  last_checked_at: string | null
}

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const date = (value: string | null) => value ? value.slice(0, 10).split('-').reverse().join('/') : '—'

export default function LogisticaPage() {
  const t = useTranslations('Logistics')
  const [tab, setTab] = useState<'tracking' | 'monitoring'>('tracking')
  const [code, setCode] = useState('')
  const [tracking, setTracking] = useState<TrackingResult | null>(null)
  const [trackingError, setTrackingError] = useState('')
  const [trackingLoading, setTrackingLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [orders, setOrders] = useState<OrderItem[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [selectedOrder, setSelectedOrder] = useState('')
  const [orderValue, setOrderValue] = useState('')
  const [monitorCode, setMonitorCode] = useState('')
  const [selectedRows, setSelectedRows] = useState<string[]>([])
  const [monitorError, setMonitorError] = useState('')
  const [monitorMessage, setMonitorMessage] = useState('')
  const [monitorLoading, setMonitorLoading] = useState(false)

  const selected = useMemo(() => orders.find((item) => item.number === selectedOrder) ?? null, [orders, selectedOrder])

  async function track() {
    setTrackingLoading(true)
    setTrackingError('')
    setTracking(null)
    try {
      const response = await fetch(`/api/logistica/rastreio?codigo=${encodeURIComponent(code)}`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message ?? t('errors.unexpected'))
      setTracking(data.result as TrackingResult)
    } catch (error) {
      setTrackingError(error instanceof Error ? error.message : t('errors.unexpected'))
    } finally {
      setTrackingLoading(false)
    }
  }

  async function loadMonitoring() {
    const [ordersResponse, shipmentsResponse] = await Promise.all([
      fetch('/api/logistica/ordens', { cache: 'no-store' }),
      fetch('/api/logistica/monitoramentos', { cache: 'no-store' }),
    ])
    const ordersData = await ordersResponse.json().catch(() => ({}))
    const shipmentsData = await shipmentsResponse.json().catch(() => ({}))
    if (ordersResponse.ok) setOrders((ordersData.items ?? []) as OrderItem[])
    if (shipmentsResponse.ok) setShipments((shipmentsData.items ?? []) as Shipment[])
    if (!ordersResponse.ok) setMonitorError(ordersData.error === 'not_configured' ? t('errors.ssotica') : t('errors.unexpected'))
  }

  useEffect(() => { void loadMonitoring() }, [])

  async function addMonitoring() {
    if (!selected) return
    setMonitorLoading(true)
    setMonitorError('')
    setMonitorMessage('')
    try {
      const response = await fetch('/api/logistica/monitoramentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_code: monitorCode, os_number: selected.number, os_date: selected.date, order_value: Number(orderValue) || 0 }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message ?? t('errors.invalidAssociation'))
      setShipments((current) => [data.item as Shipment, ...current])
      setMonitorMessage(data.linked ? t('monitoring.associated') : t('monitoring.associatedNoContact'))
      setMonitorCode('')
      setSelectedOrder('')
      setOrderValue('')
    } catch (error) {
      setMonitorError(error instanceof Error ? error.message : t('errors.unexpected'))
    } finally {
      setMonitorLoading(false)
    }
  }

  async function removeSelected() {
    if (!selectedRows.length) return
    const response = await fetch('/api/logistica/monitoramentos', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selectedRows }) })
    if (response.ok) {
      setShipments((current) => current.filter((item) => !selectedRows.includes(item.id)))
      setSelectedRows([])
    }
  }

  async function copyStatus() {
    if (!tracking) return
    const text = [`${tracking.code} — ${tracking.status}`, ...tracking.events.map((event) => `${event.date ?? ''} ${event.status}${event.location ? ` — ${event.location}` : ''}`)].join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Package className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="flex gap-2 border-b border-border">
        <button type="button" onClick={() => setTab('tracking')} className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'tracking' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>{t('tabs.tracking')}</button>
        <button type="button" onClick={() => setTab('monitoring')} className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'monitoring' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>{t('tabs.monitoring')}</button>
      </div>

      {tab === 'tracking' ? (
        <section className="max-w-3xl rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">{t('tracking.title')}</h2>
          <label htmlFor="tracking-code" className="mt-5 block text-sm font-medium text-foreground">{t('tracking.codeLabel')}</label>
          <div className="mt-2 flex gap-2">
            <input id="tracking-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') void track() }} placeholder="EA000906951BR" className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm uppercase" maxLength={13} />
            <button type="button" onClick={() => void track()} disabled={trackingLoading} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">{trackingLoading && <Loader2 className="size-4 animate-spin" />}{t('tracking.consult')}</button>
          </div>
          {trackingError && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{trackingError}</p>}
          {tracking && <div className="mt-5 rounded-lg border border-border bg-background p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{tracking.code}</p><p className="mt-1 text-lg font-semibold text-foreground">{tracking.status}</p></div><button type="button" onClick={() => void copyStatus()} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted">{copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}{copied ? t('tracking.copied') : t('tracking.copy')}</button></div><div className="mt-4 space-y-3">{tracking.events.map((event, index) => <div key={`${event.date}-${index}`} className="border-l-2 border-primary/40 pl-3"><p className="text-sm font-medium text-foreground">{event.status}</p><p className="text-xs text-muted-foreground">{event.date ?? ''}{event.location ? ` · ${event.location}` : ''}</p>{event.detail && <p className="mt-1 text-xs text-muted-foreground">{event.detail}</p>}</div>)}</div></div>}
        </section>
      ) : (
        <section className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-foreground">{t('monitoring.title')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('monitoring.subtitle')}</p></div><button type="button" onClick={() => void loadMonitoring()} className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted" aria-label={t('monitoring.refresh')}><RefreshCw className="size-4" /></button></div>
            <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"><div><label htmlFor="monitor-code" className="block text-sm font-medium text-foreground">{t('tracking.codeLabel')}</label><input id="monitor-code" value={monitorCode} onChange={(event) => setMonitorCode(event.target.value.toUpperCase())} placeholder="EA000906951BR" maxLength={13} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm uppercase" /></div><div><label htmlFor="monitor-order" className="block text-sm font-medium text-foreground">{t('monitoring.orderLabel')}</label><select id="monitor-order" value={selectedOrder} onChange={(event) => setSelectedOrder(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"><option value="">{t('monitoring.orderPlaceholder')}</option>{orders.map((order) => <option key={`${order.date}-${order.number}`} value={order.number}>{`${date(order.date)} · O.S. ${order.number} · ${order.customerName || '—'}`}</option>)}</select></div><button type="button" onClick={() => void addMonitoring()} disabled={monitorLoading || !selectedOrder || !monitorCode} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">{monitorLoading && <Loader2 className="size-4 animate-spin" />}{t('monitoring.ok')}</button></div>
            {selected && <div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-md bg-muted/40 p-3 text-sm"><p className="font-medium text-foreground">{selected.customerName || '—'}</p><p className="text-muted-foreground">{date(selected.date)} · O.S. {selected.number} · {money(selected.value)}</p></div><div><label htmlFor="order-value" className="block text-xs font-medium text-muted-foreground">{t('monitoring.valueLabel')}</label><input id="order-value" value={orderValue} onChange={(event) => setOrderValue(event.target.value)} placeholder="0,00" inputMode="decimal" className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm" /></div></div>}
            {monitorError && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{monitorError}</p>}
            {monitorMessage && <p className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{monitorMessage}</p>}
          </div>
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-foreground">{t('monitoring.listTitle')}</h2><button type="button" onClick={() => void removeSelected()} disabled={!selectedRows.length} className="inline-flex items-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive disabled:opacity-40"><Trash2 className="size-4" />{t('monitoring.delete')}</button></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="w-10 px-2 py-3"></th><th className="px-2 py-3">{t('monitoring.columns.date')}</th><th className="px-2 py-3">{t('monitoring.columns.os')}</th><th className="px-2 py-3">{t('monitoring.columns.customer')}</th><th className="px-2 py-3">{t('monitoring.columns.value')}</th><th className="px-2 py-3">{t('monitoring.columns.code')}</th><th className="px-2 py-3">{t('monitoring.columns.status')}</th></tr></thead><tbody>{shipments.map((item) => <tr key={item.id} className="border-b border-border/70"><td className="px-2 py-3"><input type="checkbox" checked={selectedRows.includes(item.id)} onChange={(event) => setSelectedRows((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} aria-label={t('monitoring.selectRow')} /></td><td className="px-2 py-3 text-muted-foreground">{date(item.os_date)}</td><td className="px-2 py-3 text-foreground">{item.os_number}</td><td className="px-2 py-3 text-foreground">{item.customer_name || '—'}</td><td className="px-2 py-3 text-muted-foreground">{money(Number(item.order_value) || 0)}</td><td className="px-2 py-3 font-mono text-xs text-foreground">{item.tracking_code}</td><td className="px-2 py-3"><span className="inline-flex items-center gap-1 text-xs text-foreground"><Check className="size-4 text-emerald-600" />{item.last_status_text ?? t('monitoring.valid')}</span>{!item.contact_id && <span className="mt-1 block text-[11px] text-amber-600">{t('monitoring.noContact')}</span>}</td></tr>)}{!shipments.length && <tr><td colSpan={7} className="px-2 py-8 text-center text-sm text-muted-foreground">{t('monitoring.empty')}</td></tr>}</tbody></table></div></div>
        </section>
      )}
    </div>
  )
}
