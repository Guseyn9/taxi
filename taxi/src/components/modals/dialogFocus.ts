/** DOM-only focus helpers: never change form values or commands. */
const openedDialogs: HTMLElement[] = []
const isActiveDialog = (node: HTMLElement) => node.isConnected && node.matches('.overlay__wrapper--active[role="dialog"]')
const syncDialogLayers = () => openedDialogs.filter(isActiveDialog).forEach((node, index) => { node.style.zIndex = String(20000 + index) })

/** Opening order can differ from DOM order when a previously mounted portal is reopened. */
export function activateDialog(node: HTMLElement): () => void {
  const previousLayer = node.style.zIndex
  openedDialogs.push(node)
  syncDialogLayers()
  return () => {
    const index = openedDialogs.lastIndexOf(node)
    if (index !== -1) openedDialogs.splice(index, 1)
    node.style.zIndex = previousLayer
    syncDialogLayers()
  }
}

export function topDialog(): HTMLElement | undefined {
  const opened = openedDialogs.filter(isActiveDialog)
  if (opened.length) return opened[opened.length - 1]
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('.overlay__wrapper--active[role="dialog"]'))
  return dialogs[dialogs.length - 1]
}

export function dialogTabStops(wrapper: HTMLElement): HTMLElement[] {
  const candidates = Array.from(wrapper.querySelectorAll<HTMLElement>(
    'button,input,select,textarea,a[href],summary,[tabindex]',
  )).filter(node => {
    if (node.tabIndex < 0 || node.matches(':disabled') || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false
    const style = window.getComputedStyle(node)
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0
  })
  // Browsers expose one Tab stop per native radio group; preserve arrow-key selection.
  return candidates.filter(node => {
    if (!(node instanceof HTMLInputElement) || node.type !== 'radio' || !node.name) return true
    const group = candidates.filter((item): item is HTMLInputElement => item instanceof HTMLInputElement && item.type === 'radio' && item.name === node.name && item.form === node.form)
    return node === (group.find(item => item.checked) || group[0])
  })
}

export function restoreDialogFocus(previous: HTMLElement | null) {
  const remaining = topDialog()
  if (remaining?.contains(document.activeElement)) return
  if (previous?.isConnected && (!remaining || remaining.contains(previous))) previous.focus({ preventScroll: true })
  else remaining?.focus({ preventScroll: true })
}
