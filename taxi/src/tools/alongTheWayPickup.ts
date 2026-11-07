interface PickupSteps {
  take: () => Promise<unknown>
  arrive: () => Promise<unknown>
  requestBoarding: (confirm: (code: string) => Promise<void>) => void
  confirm: (code: string) => Promise<unknown>
  boarded: () => void
}

/** Taking and arrival must be acknowledged before asking for a boarding code. */
export async function prepareAlongTheWayPickup(steps: PickupSteps): Promise<void> {
  await steps.take()
  await steps.arrive()
  steps.requestBoarding(async code => {
    await steps.confirm(code)
    steps.boarded()
  })
}
