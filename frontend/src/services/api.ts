import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // Surface a clean error message rather than axios internals
    const msg =
      err.response?.data?.detail ||
      err.response?.data?.message ||
      err.message ||
      'Network error'
    return Promise.reject(new Error(msg))
  }
)

export default api
