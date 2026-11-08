/** Local decline state is a projection of an acknowledged server cancellation. */
export async function confirmOfferDecline(
  confirm: () => Promise<unknown>,
  project: () => void,
  refresh: () => void,
) {
  try {
    await confirm()
    project()
  } finally { refresh() }
}
