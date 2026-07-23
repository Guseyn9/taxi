/**
 * Cancel-reason directories (SITE_CONSTANTS.*_CANCEL_REASONS) store either a
 * ready-made label or an i18n key, because the admin backend can override the
 * list with free-form text. Resolving that lived as a copy-pasted pair of
 * helpers inside CancelModal and DriverChoiceCancelReasonModal; the driver trip
 * modal is the third consumer, so it lives here now.
 */

import { t } from '../localization'

export interface IReasonEntry {
  id: string
  label: string
}

export function getLocalizedReasonLabel(label: string) {
  const value = String(label ?? '').trim()
  if (!value)
    return ''

  return /^[a-z0-9_.-]+$/i.test(value) ? t(value) : value
}

export function getLocalizedCancelReasons(reasons: IReasonEntry[]) {
  return reasons
    .map(item => ({
      ...item,
      label: getLocalizedReasonLabel(item.label),
    }))
    .filter(item => Boolean(item.label))
}
