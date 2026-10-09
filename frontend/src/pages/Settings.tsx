import { useState } from 'react'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-4">
      <p className="section-title">{title}</p>
      {children}
    </div>
  )
}

function FieldRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="sm:w-56 flex-shrink-0">
        <p className="text-sm font-medium text-neutral-700">{label}</p>
        {description && <p className="text-xs text-neutral-400 mt-0.5">{description}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

export default function Settings() {
  const [saved, setSaved] = useState(false)

  const showSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">System configuration — thresholds, limits, and connection settings</p>
      </div>

      {saved && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-medium px-4 py-2 rounded">
          ✓ Settings saved (restart backend to apply changes)
        </div>
      )}

      {/* Simulation */}
      <Section title="Simulation">
        <FieldRow label="Default Speed" description="Simulation speed multiplier on startup">
          <select className="input w-32" defaultValue="1">
            {[1, 10, 60, 300].map((v) => <option key={v} value={v}>{v}×</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Default Weather" description="Weather scenario on startup">
          <select className="input w-40" defaultValue="clear">
            <option value="clear">Clear</option>
            <option value="partly_cloudy">Partly Cloudy</option>
            <option value="cloudy">Cloudy</option>
            <option value="rain">Rain</option>
          </select>
        </FieldRow>
        <FieldRow label="Simulation Mode" description="Master toggle — if off, uses real hardware when available">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" defaultChecked className="rounded accent-solar-500 w-4 h-4" />
            <span className="text-sm text-neutral-700">Simulation mode active</span>
          </label>
        </FieldRow>
      </Section>

      {/* Panel limits */}
      <Section title="Panel Limits">
        <FieldRow label="Minimum Angle" description="Panel will not go below this angle">
          <div className="flex items-center gap-2">
            <input type="number" defaultValue={0} min={0} max={20} className="input w-20" />
            <span className="text-sm text-neutral-400">degrees</span>
          </div>
        </FieldRow>
        <FieldRow label="Maximum Angle" description="Panel will not exceed this angle">
          <div className="flex items-center gap-2">
            <input type="number" defaultValue={70} min={30} max={90} className="input w-20" />
            <span className="text-sm text-neutral-400">degrees</span>
          </div>
        </FieldRow>
        <FieldRow label="Movement Threshold" description="Minimum angle change required to trigger motor movement">
          <div className="flex items-center gap-2">
            <input type="number" defaultValue={3} min={0.5} max={10} step={0.5} className="input w-20" />
            <span className="text-sm text-neutral-400">degrees</span>
          </div>
        </FieldRow>
        <FieldRow label="Tracking Interval" description="How often the auto-tracking cycle runs (real hardware)">
          <div className="flex items-center gap-2">
            <input type="number" defaultValue={600} min={30} max={3600} step={30} className="input w-24" />
            <span className="text-sm text-neutral-400">seconds</span>
          </div>
        </FieldRow>
      </Section>

      {/* Site location */}
      <Section title="Site Location">
        <FieldRow label="Latitude" description="Site latitude (decimal degrees)">
          <input type="number" defaultValue={20.5937} step={0.0001} className="input w-40" />
        </FieldRow>
        <FieldRow label="Longitude" description="Site longitude (decimal degrees)">
          <input type="number" defaultValue={78.9629} step={0.0001} className="input w-40" />
        </FieldRow>
        <FieldRow label="Altitude" description="Site altitude in metres">
          <div className="flex items-center gap-2">
            <input type="number" defaultValue={300} className="input w-24" />
            <span className="text-sm text-neutral-400">metres</span>
          </div>
        </FieldRow>
        <FieldRow label="Timezone">
          <input type="text" defaultValue="Asia/Kolkata" className="input w-40" />
        </FieldRow>
      </Section>

      {/* Hardware connection */}
      <Section title="Hardware Connection (Future)">
        <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-xs text-neutral-500 mb-3">
          These settings are used when real hardware is connected. They have no effect in simulation mode.
        </div>
        <FieldRow label="ESP32 IP Address">
          <input type="text" defaultValue="192.168.1.100" placeholder="192.168.x.x" className="input w-40 text-sm font-mono" />
        </FieldRow>
        <FieldRow label="ESP32 Port">
          <input type="number" defaultValue={80} className="input w-24" />
        </FieldRow>
        <FieldRow label="Device Offline Threshold" description="Mark device offline after this many seconds">
          <div className="flex items-center gap-2">
            <input type="number" defaultValue={60} className="input w-20" />
            <span className="text-sm text-neutral-400">seconds</span>
          </div>
        </FieldRow>
      </Section>

      {/* Display */}
      <Section title="Display">
        <FieldRow label="Update Rate" description="How often the dashboard polls when WebSocket is unavailable">
          <select className="input w-32" defaultValue="2000">
            <option value="1000">1 second</option>
            <option value="2000">2 seconds</option>
            <option value="5000">5 seconds</option>
          </select>
        </FieldRow>
        <FieldRow label="Temperature Unit">
          <select className="input w-28" defaultValue="celsius">
            <option value="celsius">Celsius (°C)</option>
            <option value="fahrenheit">Fahrenheit (°F)</option>
          </select>
        </FieldRow>
        <FieldRow label="Currency">
          <input type="text" defaultValue="₹" className="input w-16 text-center" maxLength={3} />
        </FieldRow>
      </Section>

      {/* Save */}
      <div className="flex gap-2">
        <button onClick={showSaved} className="btn btn-primary">Save Settings</button>
        <button className="btn btn-secondary">Reset to Defaults</button>
      </div>

      <p className="text-xs text-neutral-400 pb-4">
        Note: Most backend settings require a server restart to take effect. 
        Changes made here update the UI only — edit <code className="bg-neutral-100 px-1 rounded">.env</code> for persistent backend config changes.
      </p>
    </div>
  )
}
