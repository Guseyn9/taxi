import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { platformInterface } from '../compositionRoot'
import type { NavigationOptions } from './NavigationRuntime'

/** Connects transport-neutral Navigation Runtime to React Router. */
export function usePlatformNavigationBridge(): void {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(
    () => platformInterface.navigationRuntime.attach({
      navigate: (path, options) => navigate(path, options),
      go: delta => navigate(delta),
    }),
    [navigate],
  )

  useEffect(() => {
    platformInterface.navigationRuntime.sync(location.pathname)
  }, [location.pathname])
}

export function usePlatformNavigate() {
  return useCallback((routeId: string, options?: NavigationOptions) => {
    platformInterface.navigationRuntime.navigate(routeId, options)
  }, [])
}

export function usePlatformNavigator() {
  return {
    navigate: usePlatformNavigate(),
    navigatePath: useCallback((path: string, options?: { readonly replace?: boolean }) => {
      platformInterface.navigationRuntime.navigatePath(path, options)
    }, []),
    go: useCallback((delta: number) => {
      platformInterface.navigationRuntime.go(delta)
    }, []),
  }
}
