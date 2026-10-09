import { useState, useCallback } from 'react'
import { telemetryService } from '../services/telemetryService'
import { useTelemetry } from '../hooks/useTelemetry'
import StatusIndicator from '../components/common/StatusIndicator'
import ErrorMessage from '../components/common/ErrorMessage'
import { fmt } from '../utils/formatters'

export default function HardwareStatus() {
  const { telemetry, deviceStatus, loading, error, refresh } = useTelemetry(10000)

  if (error) return <ErrorMessage message={error} onRetry={refresh} />

  const t = telemetry
  const ds = deviceStatus
  const online = ds?.status === 'online'

  type SensorRow = {
    name: string
    status: 'online' | 'offline' | 'error' | 'unknown'
    detail: string
    iface: string
    gpio: string
  }

  const sensors: SensorRow[] = [
    {
      name: 'BME280',
      status: online && t?.temperature != null ? 'online' : online ? 'error' : 'offline',
      detail: t?.temperature != null ? `${fmt.temp(t.temperature)} / ${fmt.humidity(t.humidity)}` : 'No data',
      iface: 'I2C',
      gpio: 'SDA=8, SCL=9',
    },
    {
      name: 'INA219',
      status: online && t?.voltage != null ? 'online' : online ? 'error' : 'offline',
      detail: t?.voltage != null ? `${fmt.voltage(t.voltage)} / ${fmt.current(t.current)}` : 'No data',
      iface: 'I2C',
      gpio: 'SDA=8, SCL=9',
    },
    {
      name: 'LDR Left',
      status: online && t?.ldr_left != null ? 'online' : online ? 'error' : 'offline',
      detail: t?.ldr_left != null ? `ADC: ${t.ldr_left}` : 'No data',
      iface: 'ADC',
      gpio: 'GPIO 4',
    },
    {
      name: 'LDR Right',
      status: online && t?.ldr_right != null ? 'online' : online ? 'error' : 'offline',
      detail: t?.ldr_right != null ? `ADC: ${t.ldr_right}` : 'No data',
      iface: 'ADC',
      gpio: 'GPIO 5',
    },
    {
      name: 'MG996R Servo',
      status: online ? 'online' : 'offline',
      detail: t?.current_angle != null ? `Angle: ${fmt.angle(t.current_angle)}` : 'No data',
      iface: 'PWM',
      gpio: 'GPIO 18',
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Hardware Status</h1>
        <p className="page-sub">ESP32-S3 and sensor health</p>
      </div>

      {loading && <div className="text-sm text-neutral-400">Loading…</div>}

      {/* ESP32 overview */}
      <div className="card">
        <div className="section-title">ESP32-S3 Controller</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-neutral-500 mb-0.5">Connection</div>
            <StatusIndicator
              status={online ? 'online' : 'offline'}
              label={online ? 'Online' : 'Offline'}
            />
          </div>
          <div>
            <div className="text-xs text-neutral-500 mb-0.5">IP Address</div>
            <div className="text-sm font-mono">{ds?.esp32_ip ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 mb-0.5">Last Seen</div>
            <div className="text-sm">
              {ds?.last_seen ? fmt.secsAgo(ds.seconds_since_seen) : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 mb-0.5">Demo Mode</div>
            <div className="text-sm">{ds?.demo_mode ? 'Yes' : 'No'}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 mb-0.5">Panel Mode</div>
            <div className="text-sm capitalize">{t?.mode ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 mb-0.5">Data Source</div>
            <div className="text-sm">{t?.data_source ?? '—'}</div>
          </div>
        </div>
      </div>

      {/* Sensor table */}
      <div className="card overflow-x-auto">
        <div className="section-title">Sensor Health</div>
        <table className="w-full">
          <thead>
            <tr>
              {['Sensor', 'Status', 'Interface', 'GPIO / Pin', 'Latest Reading'].map((h) => (
                <th key={h} className="table-th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sensors.map((s) => (
              <tr key={s.name} className="hover:bg-neutral-50">
                <td className="table-td font-medium text-neutral-800">{s.name}</td>
                <td className="table-td">
                  <StatusIndicator status={s.status} label={s.status} />
                </td>
                <td className="table-td">{s.iface}</td>
                <td className="table-td font-mono text-xs">{s.gpio}</td>
                <td className="table-td text-neutral-600">{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pin map reference */}
      <div className="card">
        <div className="section-title">GPIO Pin Map — ESP32-S3</div>
        <table className="w-full">
          <thead>
            <tr>
              {['GPIO', 'Function', 'Connected to', 'Notes'].map((h) => (
                <th key={h} className="table-th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['8',  'I2C SDA',      'BME280 + INA219', 'Shared I2C bus'],
              ['9',  'I2C SCL',      'BME280 + INA219', 'Shared I2C bus'],
              ['18', 'PWM (Servo)',  'MG996R signal',   'External 5–6 V power required'],
              ['4',  'ADC Input',    'LDR 1',           '12-bit ADC, 0–4095'],
              ['5',  'ADC Input',    'LDR 2',           '12-bit ADC, 0–4095'],
              ['3V3','Power',        'BME280, INA219',  'Sensor supply only'],
              ['GND','Ground',       'All common GND',  'Servo GND shared with ESP32'],
            ].map(([gpio, fn, conn, note]) => (
              <tr key={gpio} className="hover:bg-neutral-50">
                <td className="table-td font-mono font-medium">{gpio}</td>
                <td className="table-td">{fn}</td>
                <td className="table-td">{conn}</td>
                <td className="table-td text-xs text-neutral-500">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-neutral-400 mt-3">
          See docs/HARDWARE_CONFIG.md for full wiring details.
        </p>
      </div>

      <div className="flex justify-end">
        <button onClick={refresh} className="btn btn-secondary btn-sm">Refresh</button>
      </div>
    </div>
  )
}
