import {fsmIntentEnabled} from '../fsmIntentGate'
import {FsmTaxiCommandTransport} from '../FsmTaxiCommandTransport'

const original=process.env.REACT_APP_FSM_ENABLED_INTENTS
afterEach(()=>{if(original===undefined)delete process.env.REACT_APP_FSM_ENABLED_INTENTS;else process.env.REACT_APP_FSM_ENABLED_INTENTS=original})
test('canonical per-operation switches also govern frontend aliases',()=>{
 process.env.REACT_APP_FSM_ENABLED_INTENTS='driver_arrived, driver_cancel_requested'
 expect(fsmIntentEnabled('driver.order.arrive')).toBe(true)
 expect(fsmIntentEnabled('driver.order.cancel')).toBe(true)
 expect(fsmIntentEnabled('ride_started')).toBe(false)
})
test('a disabled operation cannot reach the network',async()=>{
 process.env.REACT_APP_FSM_ENABLED_INTENTS='driver_arrived'
 const request=jest.fn()
 const transport=new FsmTaxiCommandTransport({apiUrl:'https://fsm.example.test',useIntentGate:true},{fetch:request})
 await expect(transport.send('12','driver_cancel_requested')).rejects.toMatchObject({code:'FSM_INTENT_DISABLED'})
 expect(request).not.toHaveBeenCalled()
})
