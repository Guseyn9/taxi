import { Page, TestInfo, expect } from '@playwright/test'
import { ISession, readOrder, driverStateOf, DRIVER_STATE } from './taxiApi'
import { DESTINATION, driverMapAction } from './driverUi'

/** Actual UI command and independent API readback; GPS alone is simulated. */
export async function finishJourneyThroughUi(driverPage: Page, passengerPage: Page, driver: ISession, orderId: string, testInfo: TestInfo) {
  for (const [role, page] of [['driver', driverPage], ['client', passengerPage]] as const)
    await page.screenshot({ path: testInfo.outputPath(`${role}-started.png`) })
  await driverPage.context().setGeolocation(DESTINATION)
  const finish = driverMapAction(driverPage, orderId)
  await expect(finish, 'arrival at the destination enables normal completion').not.toHaveClass(/finish-drive-button--interrupted/, { timeout: 120000 })
  await finish.click()
  await expect.poll(async () => driverStateOf(await readOrder(driver, orderId), driver.userId), { timeout: 90000 }).toBe(DRIVER_STATE.Finished)
  await expect(finish).toBeHidden({ timeout: 90000 })
  await expect(passengerPage.locator('.rating-modal'), 'passenger receives the rating screen after server-confirmed completion').toBeVisible({ timeout: 90000 })
  for (const [role, page] of [['driver', driverPage], ['client', passengerPage]] as const)
    await page.screenshot({ path: testInfo.outputPath(`${role}-finished.png`) })
  for (const [role, page, stars] of [['driver', driverPage, 4], ['client', passengerPage, 5]] as const) {
    const modal = page.locator('.rating-modal')
    await expect(modal, `${role} receives a review for this completed order`).toBeVisible()
    await expect(modal.locator('.rating-modal__order-id')).toContainText(orderId)
    for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height })
      const geometry = await modal.evaluate(element => {
        const radios = Array.from(element.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, viewport: innerWidth,
          targets: radios.map(radio => ({ width: radio.getBoundingClientRect().width, height: radio.getBoundingClientRect().height })) }
      })
      expect(geometry.left).toBeGreaterThanOrEqual(0)
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport)
      expect(geometry.targets).toHaveLength(5)
      for (const target of geometry.targets) {
        expect(target.width).toBeGreaterThanOrEqual(44)
        expect(target.height).toBeGreaterThanOrEqual(44)
      }
      await modal.getByRole('radio', { name: `${stars} / 5`, exact: true }).check()
      await expect(modal.locator('button[type="submit"]')).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: testInfo.outputPath(`${role}-rating-${width}x${height}.png`) })
    }
    const sent = page.waitForResponse(response => response.request().method() === 'POST' &&
      response.url().endsWith(`/drive/get/${orderId}`) &&
      /name="action"\r?\n\r?\nset_rate\r?\n/.test(response.request().postData() ?? ''))
    await modal.locator('button[type="submit"]').click()
    expect(String((await (await sent).json()).code)).toBe('200')
    await expect(modal).toBeHidden()
    await expect.poll(async () => {
      const snapshot = await readOrder(driver, orderId)
      return Number(role === 'client' ? snapshot.b_rating : snapshot.drivers?.find(item => String(item.u_id) === driver.userId)?.c_rating)
    }).toBe(stars)
    await page.screenshot({ path: testInfo.outputPath(`${role}-rating-saved.png`) })
  }
  testInfo.annotations.push({ type: 'journey', description: `orderId=${orderId}; driver Finished; both UI ratings saved and independently read back; GPS simulated` })
}
