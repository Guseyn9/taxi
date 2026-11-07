import {getApiErrorMessage} from './apiMessages'
jest.mock('../localization',()=>({t:(key)=>key,TRANSLATION:{WRONG_BOARDING_CODE:'wrong_boarding_code',CAR_ERROR_DETAILS_INVALID:'car_details_invalid',API_ERROR_GENERIC:'generic'}}))
test('a wrapped PIN rejection is not misclassified by the JSON property name details',()=>{
 const text=getApiErrorMessage({message:'wrong driver code',details:{code:'404',status:'error'}},{context:'driver-order'})
 expect(text).toContain('wrong_boarding_code');expect(text).not.toContain('car_details_invalid')
})
test('diagnostic property names cannot turn an unknown failure into a vehicle-details error',()=>{
 expect(getApiErrorMessage({message:'connection lost',details:{}})).toContain('generic')
 expect(getApiErrorMessage({message:'wrong details'})).toContain('car_details_invalid')
})
test.each(['FSM_COMMAND_PENDING','FSM_COMMAND_RECOVERY_REQUIRED','FSM_COMMAND_RECOVERY_LIMIT'])('pending command explains the next step without exposing transport internals: %s',code=>{
 expect(getApiErrorMessage({code,message:'Check instance XYZ',details:{token:'test-not-for-display'}})).toBe('driver_action_result_pending')
})
