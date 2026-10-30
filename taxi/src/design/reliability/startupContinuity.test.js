import {resetStaleAppCache} from '../../appCache'
jest.mock('../../tools/rawLog',()=>({writeRawLog:jest.fn()}))

it('keeps a selected driver, request type and boarding stage across startup and new builds',()=>{
 localStorage.clear();sessionStorage.clear()
 const values={passengerConfirmedDriverChoices:'{"18432":"1420"}',passengerChoiceOrderModes:'{"18432":"vote"}',driverVotingArrived:'["18432"]',driverStartedVotingOrderIds:'["18432"]',driverVotingParticipations:'["18432"]'}
 Object.entries(values).forEach(([key,value])=>localStorage.setItem(key,value))
 localStorage.setItem('gruzvill_app_cache_version','old-build')
 localStorage.setItem('gruzvill_browser_emulator_driver_order_ids_v2','obsolete-demo')
 sessionStorage.setItem('taxi.ui.selected-trip:1419','18432')
 resetStaleAppCache();resetStaleAppCache()
 Object.entries(values).forEach(([key,value])=>expect(localStorage.getItem(key)).toBe(value))
 expect(sessionStorage.getItem('taxi.ui.selected-trip:1419')).toBe('18432')
 expect(localStorage.getItem('gruzvill_browser_emulator_driver_order_ids_v2')).toBeNull()
})
