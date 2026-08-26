import { defineConfig, devices } from '@playwright/test'

/**
 * E2E прогоняются против ЖИВОГО backend (см. e2e/README.md): Taxi API, Command
 * API, FSM и состояние заказа не подменяются. Мокируется только то, что к
 * проверяемому сценарию не относится, — тайлы карты.
 */

const APP_URL = process.env.E2E_APP_URL || 'http://localhost:3000'
const REUSE_SERVER = !process.env.CI || !!process.env.E2E_APP_URL

export default defineConfig({
  testDir: './e2e',
  // Живой backend отвечает не мгновенно, а voting-сценарий проходит несколько
  // переходов подряд. Ожидания всё равно по условию, а не по таймеру.
  timeout: 5 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
  // Тесты делят одного тестового водителя и его машину, поэтому идут строго
  // по одному: параллельный прогон ломал бы состояние заказа друг у друга.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ?
    [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'e2e-results/results.json' }]] :
    [['list'], ['html', { open: 'never' }]],
  outputDir: 'e2e-results/artifacts',

  use: {
    baseURL: APP_URL,
    locale: 'ru-RU',
    // §23 ТЗ: при падении должно остаться чем разбираться.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    permissions: ['geolocation'],
    actionTimeout: 30 * 1000,
    navigationTimeout: 60 * 1000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'driver-boarding',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/driver.json',
      },
    },
  ],

  webServer: {
    command: 'npm start',
    url: APP_URL,
    reuseExistingServer: REUSE_SERVER,
    timeout: 5 * 60 * 1000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { BROWSER: 'none' },
  },
})
