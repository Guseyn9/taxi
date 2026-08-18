/**
 * Короткий адрес для карточек заказа.
 *
 * Геокодер отдаёт полный административный адрес — «улица, исторический район,
 * район, город, городской округ, область, федеральный округ, индекс, страна».
 * На телефоне такая строка занимает пол-карточки, и заказ перестаёт читаться:
 * водителю нужны объект/улица с номером дома и населённый пункт, всё остальное
 * у всех заказов в списке одинаковое.
 */

/** Больше этой длины короткий адрес обрезается многоточием. */
export const SHORT_ADDRESS_MAX_LENGTH = 48

// Границы слов заданы через пробелы, а не через \b и \w: в JS без Unicode-флага
// они работают только для латиницы, и на кириллице такой шаблон молча не срабатывает.
const WORD_START = '(?:^|\\s)'
const WORD_END = '(?:\\s|$)'

/** Части адреса, одинаковые для всего города и потому бесполезные в списке. */
const ADMINISTRATIVE_PART = new RegExp([
  '^\\d{4,}$',                        // почтовый индекс
  `${WORD_START}федеральн[а-яё]*\\s+округ`,
  `${WORD_START}городск[а-яё]*\\s+округ`,
  `${WORD_START}муниципальн[а-яё]*\\s+(?:округ|район)`,
  `${WORD_START}(?:микро)?район${WORD_END}`,
  `${WORD_START}(?:область|край|края|республика)${WORD_END}`,
].join('|'), 'i')

/** Номер дома приходит отдельной частью и без улицы/объекта смысла не имеет. */
const HOUSE_NUMBER_PART = /^\d+[^\s]{0,4}$/

/** Сколько содержательных (не номер дома) частей оставляем. */
const MEANINGFUL_PARTS_LIMIT = 2

function truncate(text: string, maxLength: number) {
  return text.length > maxLength ?
    `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` :
    text
}

export function formatShortAddress(
  address?: unknown,
  maxLength = SHORT_ADDRESS_MAX_LENGTH,
): string {
  const text = String(address ?? '').replace(/\s+/g, ' ').trim()
  if (!text)
    return ''

  const parts = text.split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !ADMINISTRATIVE_PART.test(part))

  const kept: string[] = []
  let meaningfulCount = 0
  for (const part of parts) {
    if (HOUSE_NUMBER_PART.test(part)) {
      // Номер дома идёт «прицепом» к предыдущей части и не тратит лимит.
      if (kept.length)
        kept.push(part)
      continue
    }

    if (meaningfulCount >= MEANINGFUL_PARTS_LIMIT)
      break

    meaningfulCount++
    kept.push(part)
  }

  // Ничего не осталось — адрес нестандартный (например, голые координаты),
  // лучше показать его как есть, чем пустое место.
  return truncate(kept.length ? kept.join(', ') : text, maxLength)
}
