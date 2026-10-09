export const fmt = {
  temp: (v: number | null | undefined) =>
    v != null ? `${v.toFixed(1)} °C` : '—',
  humidity: (v: number | null | undefined) =>
    v != null ? `${v.toFixed(1)} %` : '—',
  pressure: (v: number | null | undefined) =>
    v != null ? `${v.toFixed(1)} hPa` : '—',
  irradiance: (v: number | null | undefined) =>
    v != null ? `${v.toFixed(1)} W/m²` : '—',
  voltage: (v: number | null | undefined) =>
    v != null ? `${v.toFixed(2)} V` : '—',
  current: (v: number | null | undefined) =>
    v != null ? `${v.toFixed(3)} A` : '—',
  power: (v: number | null | undefined) =>
    v != null ? `${v.toFixed(2)} W` : '—',
  energy: (v: number | null | undefined) =>
    v != null ? `${v.toFixed(2)} Wh` : '—',
  angle: (v: number | null | undefined) =>
    v != null ? `${v.toFixed(1)}°` : '—',
  pct: (v: number | null | undefined) =>
    v != null ? `${v.toFixed(1)} %` : '—',
  currency: (v: number | null | undefined, sym = '₹') =>
    v != null ? `${sym}${v.toFixed(2)}` : '—',
  ts: (iso: string | null | undefined) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  },
  timeOnly: (iso: string | null | undefined) => {
    if (!iso) return ''
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit',
    })
  },
  dateOnly: (iso: string | null | undefined) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  },
  secsAgo: (secs: number | null | undefined) => {
    if (secs == null) return '—'
    if (secs < 60) return `${Math.round(secs)}s ago`
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`
    return `${Math.round(secs / 3600)}h ago`
  },
}
