interface Props {
  faults: string[]
}

export default function FaultBanner({ faults }: Props) {
  if (!faults.length) return null
  return (
    <div className="rounded border border-red-200 bg-red-50 px-4 py-3 mb-4">
      <div className="flex items-start gap-2">
        <span className="text-red-600 text-lg leading-none">⚠</span>
        <div>
          <p className="text-sm font-semibold text-red-700 mb-1">
            {faults.length === 1 ? 'Active Fault' : `${faults.length} Active Faults`}
          </p>
          <ul className="space-y-0.5">
            {faults.map((f) => (
              <li key={f} className="text-xs text-red-600">{f}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
