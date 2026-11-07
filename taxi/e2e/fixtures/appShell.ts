/** Shared app boot assertion. A failed config must fail the test, not trigger hidden reloads. */
import {BrowserContext,Page} from '@playwright/test'

export async function expectAppBooted(page:Page):Promise<void> {
  const ready=(async()=>{
    await page.locator('main.layout[data-config-status="Success"] header').first().waitFor({state:'visible',timeout:90_000})
    await page.getByTestId('app-config-unavailable').waitFor({state:'hidden',timeout:90_000})
    return 'ready'
  })()
  const failed=page.locator('[data-testid="app-config-unavailable"][data-config-status="Fail"]')
    .waitFor({state:'visible',timeout:90_000}).then(()=>'failed')
  let outcome:string
  try {outcome=await Promise.race([ready,failed])}
  catch {throw new Error('E2E: приложение не завершило загрузку конфигурации за 90 секунд')}
  finally {void ready.catch(()=>undefined);void failed.catch(()=>undefined)}
  if(outcome!=='ready')throw new Error('E2E: загрузка конфигурации завершилась отказом; автоматическая перезагрузка запрещена')
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
