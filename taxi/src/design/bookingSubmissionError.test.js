import {bookingSubmissionError, bookingSubmissionUnconfirmed} from './bookingSubmissionError'
jest.mock('../localization',()=>({t:(key,options)=>options?.fallback || key}))
test('a business refusal explains the fare offer and never exposes raw request details',()=>{
 const error={status:'error',code:'404',message:'wrong b_options keys token=private'}
 expect(bookingSubmissionError(error,'offer','ru')).toContain('Сумма сохранена')
 expect(bookingSubmissionError(error,'offer','ru')).not.toMatch(/private|b_options|Ошибка$/)
 expect(bookingSubmissionUnconfirmed(error)).toBe(false)
})

const unsupportedOffer = { status: 'error', code: '404', message: 'wrong b_options keys: offer_mode' }

test.each([unsupportedOffer, { isAxiosError: true, response: { status: 200, data: unsupportedOffer } }])(
 'explains a confirmed unsupported custom fare without asking the passenger to retry',
 error => {
  const message = bookingSubmissionError(error, 'offer', 'ru')
  expect(message).toContain('не принимает заказы со своей ценой')
  expect(message).toContain('Сумма сохранена')
  expect(message).not.toMatch(/offer_mode|попробуйте снова/)
  expect(bookingSubmissionUnconfirmed(error)).toBe(false)
 },
)

test('an ambiguous response with an offer-like error body still requires checking orders', () => {
 const error = { isAxiosError: true, response: { status: 503, data: unsupportedOffer } }
 expect(bookingSubmissionError(error, 'offer', 'ru')).toContain('Проверьте список заказов')
 expect(bookingSubmissionUnconfirmed(error)).toBe(true)
})
test.each([undefined,new Error('Ошибка'),{isAxiosError:true,message:'Network Error'},{code:'ECONNABORTED'},{}])('unknown outcome warns about readback instead of declaring the request unsent: %s',error=>{
 expect(bookingSubmissionError(error,'offer','ru')).toContain('Проверьте список заказов')
 expect(bookingSubmissionUnconfirmed(error)).toBe(true)
})
test('known client validation and authentication failures remain actionable',()=>{
 expect(bookingSubmissionError(new Error('Unauthorized user'),'order','ru')).toContain('Войдите')
 expect(bookingSubmissionUnconfirmed(new Error('Unauthorized user'))).toBe(false)
 expect(bookingSubmissionError(new Error('point from select field'),'order','ru')).toContain('Откуда')
})
test.each(['ru','en','fr','ar'])('every supported fallback has contextual copy for %s',iso=>{
 expect(bookingSubmissionError({status:'error'},'offer',iso).length).toBeGreaterThan(35)
})
