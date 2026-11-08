import {bookingSubmissionError, bookingSubmissionUnconfirmed} from './bookingSubmissionError'
jest.mock('../localization',()=>({t:(key,options)=>options?.fallback || key}))
test('a business refusal explains the fare offer and never exposes raw request details',()=>{
 const error={status:'error',code:'404',message:'wrong b_options keys token=private'}
 expect(bookingSubmissionError(error,'offer','ru')).toContain('Сумма сохранена')
 expect(bookingSubmissionError(error,'offer','ru')).not.toMatch(/private|b_options|Ошибка$/)
 expect(bookingSubmissionUnconfirmed(error)).toBe(false)
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
