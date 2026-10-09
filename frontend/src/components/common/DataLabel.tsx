interface Props {
  source: string
}

const styles: Record<string, string> = {
  live:       'bg-green-100 text-green-800 border-green-200',
  demo:       'bg-amber-100 text-amber-800 border-amber-200',
  simulation: 'bg-blue-100 text-blue-800 border-blue-200',
  no_data:    'bg-neutral-100 text-neutral-500 border-neutral-200',
}

export default function DataLabel({ source }: Props) {
  const style = styles[source] ?? styles.no_data
  return (
    <span className={`inline-block border rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide ${style}`}>
      {source === 'live' ? 'Live Hardware' : source === 'demo' ? 'Demo Data' : source}
    </span>
  )
}
