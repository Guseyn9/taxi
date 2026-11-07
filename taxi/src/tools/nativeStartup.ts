interface NativeBridge { postMessage(message: string): void }
let startedBridge: NativeBridge | undefined

/** Once per native bridge in this document, including StrictMode effect replay. */
export function notifyNativeStartup(bridge?: NativeBridge): void {
  if (!bridge || startedBridge === bridge) return
  bridge.postMessage(JSON.stringify({ type: 'SYSTEM', message: 'START' }))
  startedBridge = bridge
}
