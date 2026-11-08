/** Browsers throttle hidden tabs. Reconcile reads when the user returns or reconnects. */
export function subscribeOrderWake(refresh: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wake = () => {
    if (document.hidden || timer !== undefined) return
    timer = setTimeout(() => { timer = undefined; if (!document.hidden) refresh() }, 100)
  }
  for (const event of ['focus','pageshow','online']) window.addEventListener(event,wake)
  document.addEventListener('visibilitychange',wake)
  return () => {
    clearTimeout(timer)
    for (const event of ['focus','pageshow','online']) window.removeEventListener(event,wake)
    document.removeEventListener('visibilitychange',wake)
  }
}
