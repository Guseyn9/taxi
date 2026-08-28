/**
 * Проект `setup` входит через настоящую форму приложения, то есть вводит логин и
 * пароль в поля страницы. К упавшему тесту Playwright безусловно прикладывает
 * `error-context.md` — ARIA-снимок страницы, где значения полей видны открытым
 * текстом (проверено: там оказываются и логин, и пароль). Отключить это
 * настройкой нельзя, а копия вложения уезжает ещё и в HTML-отчёт.
 *
 * Trace, video и screenshot у `setup` уже выключены в playwright.config.ts —
 * этот репортёр убирает последнее, что осталось: снимает вложение с результата
 * (поэтому его не увидят ни HTML-, ни JSON-репортёр) и удаляет файл с диска.
 * Сообщение об ошибке и стек при этом сохраняются целиком.
 *
 * Проекта со сценарием это не касается: он ходит по storageState и учётных
 * данных в DOM не держит.
 */

import fs from 'fs'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

/** Вложения, которые содержат снимок страницы целиком. */
const PAGE_SNAPSHOT_ATTACHMENTS = new Set(['error-context'])

const PROTECTED_PROJECT = 'setup'

class StripSetupErrorContext implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    if (test.parent.project()?.name !== PROTECTED_PROJECT)
      return

    const kept = result.attachments.filter((attachment) => {
      if (!PAGE_SNAPSHOT_ATTACHMENTS.has(attachment.name))
        return true
      if (attachment.path)
        fs.rmSync(attachment.path, { force: true })
      return false
    })

    // Массив меняется на месте: остальные репортёры смотрят на этот же объект.
    result.attachments.length = 0
    result.attachments.push(...kept)
  }
}

export default StripSetupErrorContext
