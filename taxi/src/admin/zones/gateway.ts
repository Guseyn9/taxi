import axios from 'axios'
import Config from '../../config'
import {apiMethod,IApiMethodArguments} from '../../tools/api'
import {Zone,ZoneKind,readZones,zonePayload} from './model'
function success(data:any) { if(String(data?.code)!=='200'||data?.status!=='success') throw new Error('Zone request failed') }
export async function readZoneCatalog():Promise<Zone[]> {
  const {data}=await axios.get(`${Config.API_URL}/data`,{params:{fields:'map_place_polygons'},timeout:10000})
  success(data)
  return readZones(data?.data?.data?.map_place_polygons)
}
async function save({formData}:IApiMethodArguments,zone:Zone,kind:ZoneKind):Promise<void> {
  formData.append('data',JSON.stringify({map_place_polygons:[zonePayload(zone,kind)]}))
  // A timeout may occur after a successful write. The UI must reread, never auto-replay.
  const {data}=await axios.post(`${Config.API_URL}/data`,formData,{timeout:15000})
  success(data)
}
export const saveZone=apiMethod(save)
