import { formatDriverRating } from './driverRating'

it('formats real numeric server scores', () => {
  expect(formatDriverRating(4.8)).toBe('4.8')
  expect(formatDriverRating(' 4.25 ')).toBe('4.3')
  expect(formatDriverRating(5)).toBe('5.0')
})

it('shows a dash for absent or invalid scores instead of fabricating a rating', () => {
  for (const value of [undefined, null, '', ' ', false, true, 0, -1, 5.1, NaN, Infinity, 'unknown', {}, []])
    expect(formatDriverRating(value)).toBe('—')
})
