/**
 * Загрузка самого приложения — общая для обеих ролей часть, до сценария.
 *
 * Конфигурацию приложение подтягивает при старте отдельным скриптом с сервера
 * (src/config.ts). Пока он не загрузился, весь интерфейс подменяется экраном
 * «Database is unavailable» (src/Routes.tsx: всё, что не EStatuses.Success), а
 * если загрузить его не удалось — страница остаётся на этом экране навсегда:
 * повторной попытки в приложении нет. Без пояснения такое падение выглядит как
 * необъяснимый таймаут ожидания элементов, которых на экране просто нет.
 */

import { BrowserContext, Page } from '@playwright/test'

/** Приложение загрузилось: отрисована шапка (components/Header). */
const appHeader = (page: Page) => page.locator('header').first()

const configScreen = (page: Page) => page.getByTestId('app-config-unavailable')

const CONFIG_FAILED = 'E2E: приложение не смогло загрузить конфигурацию с бэкенда ' +
  '(скрипт data_<config>.js, см. src/config.ts) и осталось на экране ' +
  '«Database is unavailable». Повторной попытки загрузки в приложении нет, ' +
  'сценарий не начинался.'

/**
 * Дождаться, пока приложение действительно поднялось. Ожидание по событию —
 * появлению интерфейса: на холодном dev-сервере первая сборка бандла идёт
 * долго, и фиксированного времени тут быть не может.
 */
export async function expectAppBooted(page: Page, timeout = 180_000): Promise<void> {
  // Падение остаётся падением: ждём не «или/или», а либо загрузку, либо
  // окончательный отказ, — второе только для того, чтобы не досиживать таймаут
  // до конца и назвать причину.
  const booted = appHeader(page).waitFor({ state: 'attached', timeout })
    .then(() => 'ready' as const)
  const failed = configScreen(page)
    .and(page.locator('[data-config-status="Fail"]'))
    .waitFor({ state: 'attached', timeout })
    .then(() => 'config-failed' as const)

  const outcome = await Promise.race([booted, failed]).catch(() => 'timeout' as const)
  // Проигравшее ожидание иначе отвалится необработанным отказом после теста.
  void booted.catch(() => undefined)
  void failed.catch(() => undefined)

  if (outcome === 'config-failed')
    throw new Error(CONFIG_FAILED)

  if (outcome === 'timeout') {
    if (await configScreen(page).count())
      throw new Error(CONFIG_FAILED)
    throw new Error(`E2E: приложение не отрисовало интерфейс за ${timeout} мс.`)
  }
}

/**
 * Единственный допустимый мок: тайлы карты. Внешний тайловый сервер ни к одному
 * из проверяемых сценариев отношения не имеет, а десятки его запросов только
 * мешают загрузке приложения.
 */
export async function stubMapTiles(context: BrowserContext): Promise<void> {
  await context.route(/tile\.openstreetmap|tiles?\..*\/\d+\/\d+\/\d+\.png/, route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }))
}
