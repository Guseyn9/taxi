import { supportHref } from './supportUrl'
it.each(['javascript:alert(1)', 'data:text/html,x', '//evil.invalid', 'https://user:password@host.invalid', 'https:\n//host.invalid', 'mailto:x@example.invalid\r\nBcc:y@example.invalid', '%6aavascript:alert(1)', 'tel:javascript:alert(1)'])('rejects unsafe contact %s', (input: string) => {
  expect(supportHref(input)).toBeNull()
})
it('preserves contact methods and HTTPS URLs containing @ in the path', () => {
  expect(supportHref('help@example.invalid')).toBe('mailto:help@example.invalid')
  expect(supportHref('https://example.invalid/@support')).toBe('https://example.invalid/@support')
  expect(supportHref('mailto:help@example.invalid')).toBe('mailto:help@example.invalid')
  expect(supportHref('tel:+212123456789')).toBe('tel:+212123456789')
})
