import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const publicConfig = {
  VITE_NALA_LABS_URL: process.env.VITE_NALA_LABS_URL ?? '',
}
const serializedConfig = JSON.stringify(publicConfig).replaceAll('<', '\\u003c')
const runtimeConfig = `globalThis.__NALA_TRACE_CONFIG__ = Object.freeze(${serializedConfig})\n`

await writeFile(new URL('./dist/runtime-config.js', import.meta.url), runtimeConfig, { mode: 0o644 })

const viteCLI = fileURLToPath(new URL('./node_modules/vite/bin/vite.js', import.meta.url))
const preview = spawn(process.execPath, [viteCLI, 'preview', '--host', '0.0.0.0', '--port', '5005'], {
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => preview.kill(signal))
}

preview.on('error', () => {
  console.error('Unable to start the Nala Trace frontend server')
  process.exitCode = 1
})
preview.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
