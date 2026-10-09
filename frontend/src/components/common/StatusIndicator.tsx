interface Props {
  status: 'online' | 'offline' | 'error' | 'warning' | 'unknown'
  label?: string
  size?: 'sm' | 'md'
}

const colours: Record<Props['status'], string> = {
  online:  'bg-green-500',
  offline: 'bg-neutral-400',
  error:   'bg-red-500',
  warning: 'bg-amber-400',
  unknown: 'bg-neutral-300',
}

const textColours: Record<Props['status'], string> = {
  online:  'text-green-700',
  offline: 'text-neutral-500',
  error:   'text-red-700',
  warning: 'text-amber-700',
  unknown: 'text-neutral-400',
}

export default function StatusIndicator({ status, label, size = 'md' }: Props) {
  const dot = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'
  const text = size === 'sm' ? 'text-xs' : 'text-sm'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`${dot} rounded-full flex-shrink-0 ${colours[status]}`} />
      {label && (
        <span className={`${text} font-medium ${textColours[status]}`}>{label}</span>
      )}
    </span>
  )
}
