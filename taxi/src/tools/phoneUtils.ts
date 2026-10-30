/**
 * Utility functions for phone number handling
 */

/**
 * Get the phone mask from site constants
 */
export const getPhoneMask = (): string => {
  // Маска используется только для отображения формата ввода
  // Например: +34(___)___-___-___ или +34___-___-___
  return (window as any).data?.site_constants?.def_maska_tel?.value || '+34(___)___-___-___'
}

/**
 * Get the prefix from the phone mask
 */
export const getPhonePrefix = (): string => {
  const mask = getPhoneMask();
  if (!mask) return '';
  
  // Extract prefix from mask like +34(___)-___-___
  const match = mask.match(/^\+?(\d+)/);
  return match ? match[1] : '';
};

/**
 * Normalize phone number for API submission
 * Replaces the original prefix with +11
 */
export const normalizePhoneNumber = (phone: string, isRegistration: boolean = false, isDriver: boolean = false): string => {
  console.log('Normalize phone number input:', { phone, isRegistration, isDriver })
  const prefix = getPhonePrefix()
  console.log('Phone prefix from mask:', prefix)
  if (!prefix) return phone

  // Удаляем все нецифровые символы (включая скобки, если они были введены)
  const digits = phone.replace(/\D/g, '')
  console.log('Digits only:', digits)
  
  // Проверяем начало номера с префикса (с + или без)
  // Скобки и другие символы форматирования игнорируются
  const prefixWithoutPlus = prefix.replace('+', '')
  console.log('Prefix without plus:', prefixWithoutPlus)
  
  if (isDriver) {
    // Для водителя всегда заменяем префикс на +11, если номер начинается с префикса маски
    if (digits.startsWith(prefixWithoutPlus)) {
      const result = '+11' + digits.slice(prefixWithoutPlus.length)
      console.log('Normalized for driver:', result)
      return result
    }
    // При входе водителя заменяем +11 на префикс из маски
    if (!isRegistration && digits.startsWith('11')) {
      const result = prefix + digits.slice(2)
      console.log('Normalized for driver login:', result)
      return result
    }
  }
  
  console.log('Phone number unchanged:', phone)
  return phone
}

/**
 * Format phone number for display
 * Ensures the original prefix is shown to the user
 */
export const formatPhoneNumber = (phone: string): string => {
  if (!phone) return ''

  const mask = getPhoneMask()
  const prefix = getPhonePrefix()
  const slots = (mask.match(/_/g) || []).length
  const digits = phone.replace(/\D/g, '')
  if (!prefix || !slots || !digits) return phone

  let localDigits: string
  if (digits.startsWith(prefix) && digits.length === prefix.length + slots) {
    localDigits = digits.slice(prefix.length)
  } else if (digits.startsWith('11') && digits.length === 2 + slots) {
    // +11 is the internal driver prefix; display the site's original prefix.
    localDigits = digits.slice(2)
  } else if (!phone.trim().startsWith('+') && digits.length === slots) {
    localDigits = digits
  } else {
    // Unknown international prefixes and incomplete/oversized values must stay lossless.
    return phone
  }

  let index = 0
  return mask.replace(/_/g, () => localDigits[index++])
}
