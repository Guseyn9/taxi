/**
 * Учётные данные для E2E. В репозиторий не попадают: тест читает их из окружения
 * (или из .env.e2e.local рядом с package.json — файл в .gitignore).
 *
 * Аккаунты — существующие тестовые учётки gruzvill, те же, что использует
 * driver-emulator. Ни одного мока: и водитель, и пассажир настоящие.
 */

import fs from 'fs'
import path from 'path'

export interface IAccount {
  readonly login: string
  readonly password: string
  readonly type: string
}

const ENV_FILE = path.resolve(__dirname, '../../.env.e2e.local')

function loadEnvFile(): Record<string, string> {
  if (!fs.existsSync(ENV_FILE))
    return {}

  const values: Record<string, string> = {}
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const separator = trimmed.indexOf('=')
    if (separator === -1)
      continue
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim()
  }

  return values
}

const fileEnv = loadEnvFile()

/**
 * Значение из окружения или из файла. Обрамляющие кавычки снимаются, как это
 * делает dotenv: секрет, заданный как "user@example.com", иначе дошёл бы до
 * формы вместе с кавычками и не прошёл бы её проверку формата.
 */
function readValue(name: string): string {
  const raw = (process.env[name] ?? fileEnv[name] ?? '').trim()
  const quoted = /^(['"])(.*)\1$/.exec(raw)
  return quoted ? quoted[2] : raw
}

function readAccount(prefix: string, role: string): IAccount {
  const login = readValue(`${prefix}_LOGIN`)
  const password = readValue(`${prefix}_PASSWORD`)

  if (!login || !password) {
    throw new Error(
      `E2E: не заданы учётные данные для роли «${role}». ` +
      `Укажите ${prefix}_LOGIN и ${prefix}_PASSWORD в окружении или в taxi/.env.e2e.local ` +
      '(см. e2e/README.md). Тест работает с живым backend и без реальных учёток запускаться не должен.',
    )
  }

  return { login, password, type: readValue(`${prefix}_TYPE`) || 'e-mail' }
}

/** Водитель, которым управляет браузер. */
export const driverAccount = () => readAccount('E2E_DRIVER', 'водитель')

/**
 * Второй водитель. Нужен только голосованию (A.1.2): смысл сценария в том, что
 * один заказ одновременно доступен нескольким водителям, и одним водителем он
 * не воспроизводится. Учётка отдельная — свои машина и сессия.
 */
export const driver2Account = () => readAccount('E2E_DRIVER2', 'второй водитель')

/**
 * Заданы ли учётные данные второго водителя. Нужно только проекту `setup`:
 * без этой проверки отсутствие новой учётки роняло бы и те тесты, которым
 * второй водитель не нужен. Сам голосовой тест на нехватку учётки падает —
 * молча пропускать сценарий он не должен.
 */
export const hasDriver2Account = () =>
  Boolean(readValue('E2E_DRIVER2_LOGIN') && readValue('E2E_DRIVER2_PASSWORD'))

/** Пассажир: создаёт голосовой заказ и выбирает водителя. */
export const passengerAccount = () => readAccount('E2E_PASSENGER', 'пассажир')

export const apiBase = () =>
  readValue('E2E_API_BASE') || 'https://ibronevik.ru/taxi/c/gruzvill/api/v1'

export const appUrl = () =>
  readValue('E2E_APP_URL') || 'http://localhost:3000'
