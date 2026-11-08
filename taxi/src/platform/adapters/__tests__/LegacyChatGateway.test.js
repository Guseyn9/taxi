import {LegacyChatGateway} from '../LegacyChatGateway'
import {ReconnectingWebSocketClient} from '../../platform-interface/realtime'
jest.mock('../LegacyBackendGateway',()=>({backendGateway:{getUser:jest.fn()}}))
jest.mock('../../platform-interface/realtime',()=>({ReconnectingWebSocketClient:jest.fn()}))
test('connection-state UI does not change the chat protocol or replay messages',()=>{
 const send=jest.fn(()=>true),stop=jest.fn();let handlers
 ReconnectingWebSocketClient.mockImplementation(()=>({connect:jest.fn((url,value)=>{expect(url).toBe('wss://chat.itest24.com:7007');handlers=value;return stop}),send}))
 const onState=jest.fn(),session=new LegacyChatGateway().connect({from:'1419_1',to:'1420_1',onMessage:jest.fn(),onState})
 handlers.onOpen();expect(JSON.parse(send.mock.calls[0][0])).toEqual({from:'1419_1',to:'1420_1',action:'start'})
 session.send('test');expect(JSON.parse(send.mock.calls[1][0])).toEqual({from:'1419_1',to:'1420_1',msg:'test',action:'send'})
 handlers.onState('closed');expect(onState).toHaveBeenCalledWith('closed');expect(send).toHaveBeenCalledTimes(2);session.close();expect(stop).toHaveBeenCalledTimes(1)
})
