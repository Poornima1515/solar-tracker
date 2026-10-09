import api from './api'
import type { ServiceDescriptor } from '../types'

export const servicesRegistry = {
  list: (): Promise<{ services: ServiceDescriptor[]; total: number; timestamp: string }> =>
    api.get('/services').then((r) => r.data),

  get: (id: string): Promise<ServiceDescriptor> =>
    api.get(`/services/${id}`).then((r) => r.data),
}
