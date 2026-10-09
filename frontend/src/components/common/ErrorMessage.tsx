interface Props {
  message: string
  onRetry?: () => void
}

export default function ErrorMessage({ message, onRetry }: Props) {
  return (
    <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span className="font-medium">Error: </span>{message}
      {onRetry && (
        <button
          onClick={onRetry}
          className="ml-3 text-xs underline hover:no-underline"
        >
          Retry
        </button>
      )}
    </div>
  )
}
