import api from './api'
import type { SimulationState, SimHistoryPoint, SystemEvent, DemoScenario } from '../types'

export const simulationService = {
  getState: (): Promise<SimulationState> =>
    api.get('/simulation/state').then((r) => r.data),

  configure: (updates: Record<string, unknown>): Promise<{ success: boolean }> =>
    api.post('/simulation/configure', updates).then((r) => r.data),

  setMode: (mode: string): Promise<{ success: boolean; mode: string }> =>
    api.post('/simulation/mode', { mode }).then((r) => r.data),

  tilt: (angle: number): Promise<{ success: boolean; target_angle: number }> =>
    api.post('/simulation/tilt', { angle }).then((r) => r.data),

  reset: (): Promise<{ success: boolean; message: string }> =>
    api.post('/simulation/reset').then((r) => r.data),

  getHistory: (limit = 200): Promise<{ history: SimHistoryPoint[]; count: number }> =>
    api.get('/simulation/history', { params: { limit } }).then((r) => r.data),

  getEvents: (limit = 50): Promise<{ events: SystemEvent[]; count: number }> =>
    api.get('/simulation/events', { params: { limit } }).then((r) => r.data),

  getScenarios: (): Promise<{ scenarios: DemoScenario[] }> =>
    api.get('/simulation/scenarios').then((r) => r.data),

  activateScenario: (name: string): Promise<{ success: boolean; scenario: string; description: string }> =>
    api.post(`/simulation/scenario/${name}`).then((r) => r.data),
}
