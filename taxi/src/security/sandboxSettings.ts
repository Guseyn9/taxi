export const SANDBOX_MAX_BYTES = 1024 * 1024
const props = new Set(['type', 'fieldName', 'fieldValue', 'html', 'inline', 'text', 'label', 'placeholder', 'alt', 'src', 'className', 'disabled', 'checked', 'defaultChecked', 'name', 'value', 'color', 'size', 'required', 'payment', 'imageProps', 'wrapperProps', 'fixedSize', 'shape', 'buttonStyle', 'skipHandler', 'status', 'colorType', 'checkLogin', 'intent', 'title', 'aria-label'])
const types = new Set(['HTML', 'Button', 'Card', 'Checkbox', 'BigTruckServices'])
function bounded(value: any, depth: number, budget: { nodes: number }): boolean {
  if (++budget.nodes > 20000 || depth > 20) return false
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return true
  if (typeof value !== 'object') return false
  return Object.keys(value).every(key =>
    !/^(?:__proto__|prototype|constructor|srcdoc|dangerouslysetinnerhtml|component|as|aschild|slots?|slotprops|componentsprops|inputprops|form|formaction|linkcomponent)$/i.test(key) &&
    !/^on/i.test(key) && bounded(value[key], depth + 1, budget))
}
/** Imported configuration is data, never polymorphic React/DOM props. */
export function isSafeSandboxBlock(block: any): boolean {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return false
  const present = Object.fromEntries(Object.entries(block).filter(([, value]) => value !== undefined))
  if (!bounded(present, 0, { nodes: 0 })) return false
  if (block.type !== undefined && !types.has(block.type)) return false
  if (!Object.keys(block).every(key => props.has(key))) return false
  for (const key of ['imageProps', 'wrapperProps']) {
    if (block[key] !== undefined && (!block[key] || typeof block[key] !== 'object' || Array.isArray(block[key]) ||
      !Object.keys(block[key]).every(name => ['src', 'alt', 'width', 'height', 'className', 'title', 'aria-label'].includes(name)))) return false
  }
  return true
}
export function parseSafeSandboxSettings(text: string): Record<string, any> | null {
  if (new TextEncoder().encode(text).length > SANDBOX_MAX_BYTES) return null
  try {
    const settings = JSON.parse(text)
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !bounded(settings, 0, { nodes: 0 })) return null
    if (!Object.keys(settings).every(key => ['blocks', 'formConfg'].includes(key))) return null
    if (settings.blocks !== undefined && (!Array.isArray(settings.blocks) || settings.blocks.length > 1000 || !settings.blocks.every(isSafeSandboxBlock))) return null
    return settings
  } catch { return null }
}
