interface Props {
  isDemo: boolean
}

export default function DemoModeBanner({ isDemo }: Props) {
  if (!isDemo) return null
  return (
    <div className="w-full bg-amber-50 border-b border-amber-200 px-4 py-1.5">
      <p className="text-center text-xs font-medium text-amber-800 tracking-wide">
        DEMO MODE — NOT LIVE HARDWARE &nbsp;·&nbsp; Values are simulated. Connect ESP32 hardware for real data.
      </p>
    </div>
  )
}
