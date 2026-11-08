import { prepareAlongTheWayPickup } from './alongTheWayPickup'
const setup = () => ({take:jest.fn().mockResolvedValue(undefined),arrive:jest.fn().mockResolvedValue(undefined),requestBoarding:jest.fn(),confirm:jest.fn().mockResolvedValue(undefined),boarded:jest.fn()})
it.each(['take','arrive'] as const)('does not open boarding or advance when %s is rejected',async (failed: 'take' | 'arrive') => {
  const steps=setup();steps[failed].mockRejectedValue(new Error('rejected'))
  await expect(prepareAlongTheWayPickup(steps)).rejects.toThrow('rejected')
  expect(steps.requestBoarding).not.toHaveBeenCalled();expect(steps.boarded).not.toHaveBeenCalled()
  if(failed==='take')expect(steps.arrive).not.toHaveBeenCalled()
})
it('marks boarding only after confirmed PIN and keeps a failed PIN retryable',async()=>{
  const steps=setup();await prepareAlongTheWayPickup(steps)
  const submit=steps.requestBoarding.mock.calls[0][0]
  expect(steps.boarded).not.toHaveBeenCalled()
  steps.confirm.mockRejectedValueOnce(new Error('wrong PIN'))
  await expect(submit('111')).rejects.toThrow('wrong PIN');expect(steps.boarded).not.toHaveBeenCalled()
  await submit('222');expect(steps.boarded).toHaveBeenCalledTimes(1)
  expect(steps.take).toHaveBeenCalledTimes(1);expect(steps.arrive).toHaveBeenCalledTimes(1)
})
