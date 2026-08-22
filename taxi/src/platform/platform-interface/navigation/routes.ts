import type { NavigationRegistry } from './NavigationRegistry'

export const PLATFORM_ROUTES = {
  PassengerOrder: 'passenger.order',
  DriverOrders: 'driver.orders',
  DriverOrder: 'driver.order',
  DriverTest: 'driver.test',
  Sandbox: 'sandbox',
} as const

export function registerPlatformRoutes(registry: NavigationRegistry): void {
  registry.register({ id: PLATFORM_ROUTES.PassengerOrder, path: '/passenger-order' })
  registry.register({ id: PLATFORM_ROUTES.DriverOrders, path: '/driver-order' })
  registry.register({ id: PLATFORM_ROUTES.DriverOrder, path: '/driver-order/:id' })
  registry.register({ id: PLATFORM_ROUTES.DriverTest, path: '/driver-order-test' })
  registry.register({ id: PLATFORM_ROUTES.Sandbox, path: '/sandbox' })
}
