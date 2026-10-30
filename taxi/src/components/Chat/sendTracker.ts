export type ChatSendState = {
  connection: 'connecting' | 'ready' | 'error'
  delivery: 'idle' | 'pending' | 'unconfirmed' | 'confirmed' | 'failed'
  text: string
}

/** A socket accepting bytes is not a delivery receipt. Only a matching server echo confirms. */
export class ChatSendTracker {
  state: ChatSendState = { connection: 'connecting', delivery: 'idle', text: '' }
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private connectionTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly sender: string, private readonly change: (state: ChatSendState) => void, retained = '') {
    if(retained)this.state={...this.state,delivery:'unconfirmed',text:retained}
    this.connecting()
  }

  private update(value: Partial<ChatSendState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...value }
    this.change(this.state)
  }

  connecting() {
    if(this.connectionTimer)clearTimeout(this.connectionTimer)
    this.update({connection:'connecting'})
    this.connectionTimer=setTimeout(()=>this.connectionError(),10000)
  }
  connected() { if(this.connectionTimer)clearTimeout(this.connectionTimer);this.connectionTimer=null;this.update({ connection: 'ready' }) }
  connectionError() { if(this.connectionTimer)clearTimeout(this.connectionTimer);this.connectionTimer=null;this.update({ connection: 'error', ...(this.state.delivery==='pending'?{delivery:'unconfirmed' as const}:{}) }) }

  submit(text: string, send: (text: string) => boolean, clearDraft: () => void): boolean {
    if (this.disposed || this.state.delivery === 'pending') return false
    if(this.state.connection!=='ready'){this.update({delivery:'failed',text});return false}
    let accepted = false
    try { accepted = send(text) } catch { accepted = false }
    if (!accepted) {
      this.update({ connection: 'error', delivery: 'failed', text })
      return false
    }
    if (this.timer) clearTimeout(this.timer)
    this.update({ delivery: 'pending', text })
    clearDraft()
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.state.delivery === 'pending') this.update({ delivery: 'unconfirmed' })
    }, 10000)
    return true
  }

  echo(from: unknown, text: unknown) {
    if (from !== this.sender || text !== this.state.text ||
      !['pending', 'unconfirmed'].includes(this.state.delivery)) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.update({ connection: 'ready', delivery: 'confirmed' })
  }

  dispose() {
    this.disposed = true
    if(this.connectionTimer)clearTimeout(this.connectionTimer)
    this.connectionTimer=null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
