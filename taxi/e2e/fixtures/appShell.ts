/**
 * Загрузка самой оболочки приложения — общая для обеих ролей часть, ДО сценария.
 *
 * Конфигурацию приложение подтягивает при старте отдельным скриптом с сервера
 * (src/config.ts): сначала `GET /api/v1/?cv=` за версией кэша, затем
 * `taxi/cache/data_<config>.js`. Пока конфигурация не загрузилась, весь
 * интерфейс подменяется экраном «Database is unavailable» (src/Routes.tsx: всё,
 * что не EStatuses.Success).
 *
 * Повторной попытки в приложении нет, поэтому один сетевой сбой оставляет
 * страницу на этом экране навсегда. На живом бэкенде это происходит регулярно
 * (измерено: 1 раз на 25 загрузок в спокойный период и сериями в периоды
 * деградации). Это дефект приложения, он описан в e2e/README.md и чинится
 * отдельной задачей — production-логику ради теста здесь не меняли.
 *
 * Поэтому загрузка оболочки — и только она — повторяется перезагрузкой
 * страницы. Это не обход проверок сценария: ни один его шаг не пропускается,
 * ни одно утверждение о состоянии заказа не смягчается, а сценарий к этому
 * моменту ещё не начинался. Каждый такой случай печатается в лог прогона и
 * попадает в аннотации теста, чтобы дефект оставался на виду.
 */

import { BrowserContext, Page, test } from '@playwright/test'

/** Приложение загрузилось: отрисована шапка (components/Header). */
const appHeader = (page: Page) => page.locator('header').first()

const configScreen = (page: Page) => page.getByTestId('app-config-unavailable')

/** Попыток загрузить оболочку, включая первую. */
const BOOT_ATTEMPTS = 3

/** Первая попытка ждёт дольше: на холодном dev-сервере идёт первая сборка бандла. */
const FIRST_BOOT_TIMEOUT_MS = 180_000
const RETRY_BOOT_TIMEOUT_MS = 45_000

type TBootOutcome = 'ready' | 'config-failed' | 'timeout'

/**
 * Ждём либо интерфейс, либо окончательный отказ загрузки конфигурации. Второе —
 * только чтобы не досиживать таймаут до конца и назвать причину.
 */
async function bootOutcome(page: Page, timeout: number): Promise<TBootOutcome> {
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
  return outcome
}

function describe(outcome: TBootOutcome, timeout: number): string {
  return outcome === 'config-failed' ?
    'приложение не смогло загрузить конфигурацию с бэкенда (скрипт data_<config>.js, ' +
      'см. src/config.ts) и осталось на экране «Database is unavailable»' :
    `приложение не отрисовало интерфейс за ${timeout} мс`
}

/**
 * Дождаться, пока приложение действительно поднялось. Ожидание по событию —
 * появлению интерфейса, — а не по таймеру.
 */
export async function expectAppBooted(page: Page): Promise<void> {
  for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt += 1) {
    const timeout = attempt === 1 ? FIRST_BOOT_TIMEOUT_MS : RETRY_BOOT_TIMEOUT_MS
    const outcome = await bootOutcome(page, timeout)
    if (outcome === 'ready')
      return

    const what = `${describe(outcome, timeout)} (попытка ${attempt} из ${BOOT_ATTEMPTS})`
    if (attempt === BOOT_ATTEMPTS)
      throw new Error(
        `E2E: ${what}. Повторной попытки загрузки в приложении нет, ` +
        'перезагрузка страницы из теста не помогла — сценарий не начинался.')

    // Дефект должен остаться заметным даже в зелёном прогоне.
    console.error(`E2E APP BOOT FAILED: ${what} — перезагружаю страницу`)
    test.info().annotations.push({ type: 'app-boot-retry', description: what })
    await page.reload()
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
