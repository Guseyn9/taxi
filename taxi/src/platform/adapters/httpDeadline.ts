import { BackendInteractionError } from './backendError'

/** A finite deadline includes response decoding; never retries a mutation. */
export async function withHttpDeadline<T>(
  operation: (signal?: AbortSignal) => Promise<T>,
  timeoutMs = 15000,
  code = 'HTTP_DEADLINE_EXCEEDED',
): Promise<T> {
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(controller?.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // The server may have committed a mutation. Refresh its state before retrying.
          reject(new BackendInteractionError(code, 'Server response timed out; check the current state before trying again', { timeoutMs: duration }))
          controller?.abort()
        }, duration)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
