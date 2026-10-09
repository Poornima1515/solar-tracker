import api from './api'
import type { ControlState, TiltCommandResponse, TrackingEvent } from '../types'

export const controlService = {
  getState: (): Promise<ControlState> =>
    api.get('/control/state').then((r) => r.data),

  tilt: (angle: number): Promise<TiltCommandResponse> =>
    api.post('/control/tilt', { angle }).then((r) => r.data),

  stop: (): Promise<{ success: boolean; current_angle: number | null; message: string }> =>
    api.post('/control/stop').then((r) => r.data),

  home: (): Promise<TiltCommandResponse> =>
    api.post('/control/home').then((r) => r.data),

  setMode: (mode: string): Promise<{ success: boolean; mode: string; message: string }> =>
    api.post('/control/mode', { mode }).then((r) => r.data),

  getEvents: (limit = 50): Promise<TrackingEvent[]> =>
    api.get('/control/events', { params: { limit } }).then((r) => r.data),

  triggerCycle: (): Promise<Record<string, unknown>> =>
    api.post('/control/trigger').then((r) => r.data),
}
