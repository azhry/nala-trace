// Vite environment values remain useful for local development. In the
// deployment image, start.mjs writes the allowlisted process environment to
// the runtime script so the image does not need environment-specific builds.
export function nalaTraceRuntimeEnvironment(buildEnvironment = import.meta.env, globalRef = globalThis) {
  const runtimeEnvironment = globalRef?.__NALA_TRACE_CONFIG__
  if (!runtimeEnvironment || typeof runtimeEnvironment !== 'object' || Array.isArray(runtimeEnvironment)) {
    return buildEnvironment
  }

  return { ...buildEnvironment, ...runtimeEnvironment }
}
