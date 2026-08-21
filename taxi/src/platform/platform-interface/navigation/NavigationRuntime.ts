import type { Unsubscribe } from '../../interaction-contract'
import type { NavigationRegistry } from './NavigationRegistry'

export interface NavigationAdapter {
  navigate(path: string, options?: { readonly replace?: boolean }): void
  go(delta: number): void
}

export interface NavigationState {
  readonly routeId: string | null
  readonly path: string
}

export interface NavigationOptions {
  readonly replace?: boolean
  readonly params?: Readonly<Record<string, string | number>>
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>
}

export class NavigationRuntime {
  private readonly registry: NavigationRegistry
  private readonly listeners: Array<(state: NavigationState) => void> = []
  private adapter: NavigationAdapter | null = null
  private state: NavigationState = Object.freeze({ routeId: null, path: '' })

  constructor(registry: NavigationRegistry) {
    this.registry = registry
  }

  attach(adapter: NavigationAdapter): Unsubscribe {
    this.adapter = adapter
    return () => {
      if (this.adapter === adapter)
        this.adapter = null
    }
  }

  navigate(routeId: string, options: NavigationOptions = {}): void {
    const path = this.registry.buildPath(routeId, options.params)
    const query = new URLSearchParams()
    Object.entries(options.query ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null)
        query.set(key, String(value))
    })
    const target = query.toString() ? `${path}?${query.toString()}` : path
    if (!this.adapter)
      throw new Error('Navigation adapter is not attached')

    this.adapter.navigate(target, { replace: options.replace })
  }

  navigatePath(path: string, options?: { readonly replace?: boolean }): void {
    if (!this.adapter)
      throw new Error('Navigation adapter is not attached')
    this.adapter.navigate(path, options)
  }

  go(delta: number): void {
    if (!this.adapter)
      throw new Error('Navigation adapter is not attached')
    this.adapter.go(delta)
  }

  sync(path: string): void {
    const route = this.registry.match(path)
    this.state = Object.freeze({ routeId: route?.id ?? null, path })
    this.listeners.slice().forEach(listener => listener(this.state))
  }

  getState(): NavigationState {
    return this.state
  }

  subscribe(listener: (state: NavigationState) => void): Unsubscribe {
    this.listeners.push(listener)
    let unsubscribed = false
    return () => {
      if (unsubscribed)
        return
      unsubscribed = true
      const index = this.listeners.indexOf(listener)
      if (index !== -1)
        this.listeners.splice(index, 1)
    }
  }
}
