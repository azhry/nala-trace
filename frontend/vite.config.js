import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8080'
  const apiProxy = {
    target: proxyTarget,
    changeOrigin: true,
    secure: false,
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': apiProxy,
        '/healthz': apiProxy,
        '/sessions': apiProxy,
        '/ingest': apiProxy,
      },
    },
  }
})
