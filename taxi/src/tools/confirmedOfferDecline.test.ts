import { confirmOfferDecline } from './confirmedOfferDecline'
it('keeps local offer and page until cancellation is acknowledged', async() => {
  let accept!: () => void
  const pending = new Promise<void>(resolve => { accept = resolve })
  const project = jest.fn(), refresh = jest.fn()
  const operation = confirmOfferDecline(() => pending, project, refresh)
  expect(project).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  accept(); await operation
  expect(project).toHaveBeenCalledTimes(1)
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('keeps the offer on refusal and still requests readback', async() => {
  const project = jest.fn(), refresh = jest.fn(), error = new Error('refused')
  await expect(confirmOfferDecline(() => Promise.reject(error), project, refresh)).rejects.toBe(error)
  expect(project).not.toHaveBeenCalled()
  expect(refresh).toHaveBeenCalledTimes(1)
})
