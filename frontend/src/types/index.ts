// ─── Simulation ───────────────────────────────────────────────────────────────

export type WeatherScenario = 'clear' | 'partly_cloudy' | 'cloudy' | 'rain'
export type MotorStatus = 'idle' | 'moving' | 'fault' | 'stopped'
export type EventSeverity = 'info' | 'warning' | 'error' | 'critical'
export type ServiceStatus = 'online' | 'offline' | 'degraded' | 'fault' | 'simulation' | 'starting'
export type ServiceType = 'sensor' | 'controller' | 'analytics' | 'ml' | 'hardware' | 'simulation'

export interface MotorState {
  status: MotorStatus
  current_angle: number
  target_angle: number
  direction: 'up' | 'down' | 'idle'
  speed_pct: number
  fault_message: string | null
}

export interface SimulationSnapshot {
  sim_time: string
  speed_multiplier: number
  weather: WeatherScenario
  is_running: boolean
  solar_elevation: number
  solar_azimuth: number
  is_daytime: boolean
  irradiance: number | null
  temperature: number | null
  humidity: number | null
  wind_speed: number | null
  pressure: number
  current_angle: number
  target_angle: number
  optimal_angle: number
  tilt_difference: number
  motor: MotorState
  power_w: number | null
  voltage: number | null
  current_a: number | null
  energy_today_wh: number
  mode: 'auto' | 'manual' | 'stopped'
  hardware_connected: boolean
  sim_mode: boolean
  fixed_panel_power_w: number | null
  improvement_pct: number | null
  active_faults: string[]
  tick_count: number
  min_limit_triggered?: boolean
  max_limit_triggered?: boolean
  auto_status?: string
  best_measured_angle?: number | null
  best_measured_power?: number | null
  search_direction?: number | null
  step_size?: number | null
  commanded_angle?: number | null
}

export interface SimulationConfig {
  speed_multiplier: number
  weather: WeatherScenario
  temperature_override: number | null
  irradiance_override: number | null
  wind_speed: number
  motor_fault: boolean
  sensor_fault: boolean
  comm_fault: boolean
  manual_target_angle: number | null
  sim_start_hour: number
}

export interface SimulationState {
  snapshot: SimulationSnapshot | null
  config: SimulationConfig | null
}

export interface SystemEvent {
  id: number
  timestamp: string
  severity: EventSeverity
  category: string
  title: string
  detail: string
}

export interface SimHistoryPoint {
  sim_time: string
  irradiance: number | null
  temperature: number | null
  power_w: number | null
  current_angle: number | null
  target_angle: number | null
  optimal_angle: number | null
  solar_elevation: number | null
  energy_wh: number | null
}

export interface DemoScenario {
  id: string
  description: string
}

export interface ServiceDescriptor {
  service_id: string
  service_name: string
  service_type: ServiceType
  description: string
  status: ServiceStatus
  health_endpoint: string | null
  data_endpoint: string | null
  capabilities: string[]
  last_seen: string | null
  version: string | null
  metadata: Record<string, unknown>
}

// ─── Device ───────────────────────────────────────────────────────────────────

export type DeviceStatus = 'online' | 'offline' | 'error'

export interface DeviceStatusSummary {
  device_id: number
  status: DeviceStatus
  last_seen: string | null
  demo_mode: boolean
  esp32_ip: string | null
  seconds_since_seen: number | null
}

// ─── Telemetry ────────────────────────────────────────────────────────────────

export type DataSource = 'live' | 'demo' | 'simulation' | 'no_data'
export type PanelMode = 'auto' | 'manual' | 'stopped'

export interface LatestTelemetry {
  timestamp: string | null
  temperature: number | null
  humidity: number | null
  pressure: number | null
  irradiance: number | null
  irradiance_source: string | null
  ldr_left: number | null
  ldr_right: number | null
  voltage: number | null
  current: number | null
  power: number | null
  energy_today: number | null
  current_angle: number | null
  target_angle: number | null
  mode: PanelMode | null
  data_source: DataSource
  hardware_online: boolean
  min_limit?: boolean
  max_limit?: boolean
  motor_status?: string
  ina219_ok?: boolean
  system_source?: 'real_hardware' | 'simulation'
  auto_status?: string | null
  best_measured_angle?: number | null
  best_measured_power?: number | null
  search_direction?: number | null
  step_size?: number | null
  active_faults?: string[]
}

export interface SensorReadingHistory {
  id: number
  timestamp: string
  temperature: number | null
  humidity: number | null
  pressure: number | null
  irradiance: number | null
  irradiance_source: string | null
  ldr_left: number | null
  ldr_right: number | null
  data_source: DataSource
}

export interface ElectricalReadingHistory {
  id: number
  timestamp: string
  voltage: number | null
  current: number | null
  power: number | null
  energy: number | null
  data_source: DataSource
}

export interface PanelPositionHistory {
  id: number
  timestamp: string
  current_angle: number | null
  target_angle: number | null
  mode: PanelMode
  data_source: DataSource
}

export interface TelemetryHistory {
  sensor: SensorReadingHistory[]
  electrical: ElectricalReadingHistory[]
  positions: PanelPositionHistory[]
  total_records: number
}

export interface DailySummary {
  date: string
  peak_power_w: number | null
  avg_power_w: number | null
  total_energy_wh: number | null
  peak_irradiance: number | null
  avg_temperature: number | null
  num_movements: number
  data_source: DataSource
}

// ─── Control ──────────────────────────────────────────────────────────────────

export interface ControlState {
  current_angle: number | null
  target_angle: number | null
  mode: PanelMode
  min_angle: number
  max_angle: number
  movement_threshold: number
  hardware_online: boolean
  demo_mode: boolean
  system_source?: 'real_hardware' | 'simulation'
  motor_status?: string
  auto_status?: string
  min_limit_triggered?: boolean
  max_limit_triggered?: boolean
  ina219_ok?: boolean
  best_measured_angle?: number | null
  best_measured_power?: number | null
}

export interface TiltCommandResponse {
  success: boolean
  current_angle: number | null
  target_angle: number | null
  status: string
  message: string | null
}

export interface TrackingEvent {
  id: number
  timestamp: string
  previous_angle: number | null
  target_angle: number | null
  actual_angle: number | null
  movement_reason: string | null
  move_triggered: boolean
  move_success: boolean | null
  delta_energy: number | null
}

// ─── ML ───────────────────────────────────────────────────────────────────────

export interface FeatureImportance {
  feature: string
  importance: number
}

export interface ModelStatus {
  model_available: boolean
  model_type: string
  target_variable: string
  training_date: string | null
  model_version: string | null
  num_training_records: number | null
  features: string[] | null
  mae: number | null
  rmse: number | null
  r2: number | null
  feature_importance: FeatureImportance[] | null
  message: string
}

export interface PredictionResponse {
  predicted_irradiance: number | null
  unit: string
  model_available: boolean
  solar_elevation: number | null
  solar_azimuth: number | null
  message: string | null
}

export interface OptimisationResponse {
  current_angle: number
  recommended_angle: number
  difference: number
  should_move: boolean
  reason: string
  predicted_irradiance: number | null
  solar_elevation: number | null
}

export interface SolarPosition {
  elevation_deg: number
  azimuth_deg: number
  zenith_deg: number
  apparent_elevation_deg: number
  equation_of_time_min: number
  optimal_tilt_single_axis_deg: number
  is_daytime: boolean
}

// ─── Comparison ───────────────────────────────────────────────────────────────

export interface ComparisonRecord {
  id: number
  date: string
  ai_energy_wh: number | null
  fixed_energy_wh: number | null
  tracking_cost_wh: number | null
  net_gain_wh: number | null
  percentage_improvement: number | null
  num_movements: number | null
  avg_ai_power_w: number | null
  avg_irradiance: number | null
  data_source: DataSource
  notes: string | null
}

export interface ComparisonSummary {
  total_ai_energy_wh: number | null
  total_fixed_energy_wh: number | null
  total_tracking_cost_wh: number | null
  total_net_gain_wh: number | null
  avg_percentage_improvement: number | null
  total_movements: number | null
  days_recorded: number
  data_source: DataSource
  note: string
}

// ─── Cost ─────────────────────────────────────────────────────────────────────

export interface BOMItem {
  component: string
  cost: number
  currency: string
}

export interface CostAnalysis {
  currency_symbol: string
  bom: BOMItem[]
  total_prototype_cost: number
  measured_daily_gain_wh: number | null
  estimated_annual_gain_kwh: number | null
  estimated_annual_revenue: number | null
  estimated_payback_years: number | null
  data_source: DataSource
  disclaimer: string
}

export interface CostAssumptionRequest {
  cost_esp32: number
  cost_servo: number
  cost_sensors: number
  cost_solar_panel: number
  cost_mechanical_frame: number
  cost_wiring_misc: number
  cost_power_supply: number
  electricity_tariff_per_kwh: number
  currency_symbol: string
  measured_daily_gain_wh: number | null
  data_source: DataSource
}
