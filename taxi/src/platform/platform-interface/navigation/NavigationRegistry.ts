export interface NavigationRoute {
  readonly id: string
  readonly path: string
}

export class NavigationRegistry {
  private readonly routes = new Map<string, NavigationRoute>()

  register(route: NavigationRoute): () => void {
    if (this.routes.has(route.id))
      throw new Error(`Navigation route already registered: ${route.id}`)

    this.routes.set(route.id, Object.freeze({ ...route }))
    let removed = false
    return () => {
      if (removed)
        return
      removed = true
      if (this.routes.get(route.id)?.path === route.path)
        this.routes.delete(route.id)
    }
  }

  get(id: string): NavigationRoute | undefined {
    return this.routes.get(id)
  }

  require(id: string): NavigationRoute {
    const route = this.get(id)
    if (!route)
      throw new Error(`Navigation route is not registered: ${id}`)
    return route
  }

  buildPath(id: string, params: Readonly<Record<string, string | number>> = {}): string {
    const route = this.require(id)
    return route.path.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) => {
      const value = params[key]
      if (value === undefined)
        throw new Error(`Navigation parameter is required: ${key}`)
      return encodeURIComponent(String(value))
    })
  }

  match(path: string): NavigationRoute | undefined {
    const pathParts = path.split('/').filter(Boolean)
    return this.list().find(route => {
      const routeParts = route.path.split('/').filter(Boolean)
      return routeParts.length === pathParts.length && routeParts.every((part, index) =>
        part.startsWith(':') || part === pathParts[index],
      )
    })
  }

  list(): readonly NavigationRoute[] {
    return Object.freeze(Array.from(this.routes.values()))
  }
}
