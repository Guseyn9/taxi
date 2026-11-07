import { createMapHint, MAP_HINT_MAX_AGE_MS, readMapHint } from './persistedMapHint'
jest.mock('../security/sessionLifecycle',()=>({privateDataScope:jest.fn(()=> 'user:tenant:1')}))
const { privateDataScope } = require('../security/sessionLifecycle')
it('restores only a recent hint owned by this account, including valid zero coordinates',()=>{
  const hint=createMapHint(0,0,1000000)
  expect(readMapHint(hint,1000010)).toEqual([0,0])
  expect(readMapHint(hint,1000000+MAP_HINT_MAX_AGE_MS+1)).toBeNull()
  privateDataScope.mockReturnValue('user:tenant:2')
  expect(readMapHint(hint,1000010)).toBeNull()
})
it('does not reinterpret unowned legacy, future, invalid or untyped coordinates as a current hint',()=>{
  privateDataScope.mockReturnValue('user:tenant:1')
  const hint=createMapHint(30,-7,1000000)
  for (const value of [{...hint,scope:undefined},{...hint,timestamp:1010000},{...hint,latitude:91},{...hint,latitude:'30'},{...hint,timestamp:NaN}])
    expect(readMapHint(value,1000000)).toBeNull()
})
