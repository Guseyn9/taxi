import {getArea,getAreasIdsBetweenPoints} from './way'
import {loadRoadArea} from '../graph/client'
import {LOCAL_GRAPH_BOUNDS} from '../graph/coverage'
import fs from 'fs'
import path from 'path'
jest.mock('../graph/client',()=>({loadRoadArea:jest.fn().mockResolvedValue({id:0})}))
it('advertises the bundled area only inside its real extent and never aliases an unrelated area',async()=>{
 expect(await getAreasIdsBetweenPoints([[30.41,-9.59],[30.42,-9.58]])).toEqual([0])
 for(const points of [[],[[33.57,-7.58]],[[30.41,-9.59],[34.02,-6.83]],[[NaN,-9.59]]])expect(await getAreasIdsBetweenPoints(points)).toEqual([])
 await expect(getArea(7)).rejects.toThrow('LOCAL_ROAD_AREA_NOT_SUPPORTED');expect(loadRoadArea).not.toHaveBeenCalled()
 await expect(getArea(0)).resolves.toEqual({id:0})
})
it('keeps the declared coverage synchronized with the bundled road dataset',()=>{
 const {nodes}=JSON.parse(fs.readFileSync(path.resolve('public/mock/agadir.json'),'utf8'))
 expect(Math.min(...nodes.map(n=>n.latitude))).toBe(LOCAL_GRAPH_BOUNDS.south)
 expect(Math.max(...nodes.map(n=>n.latitude))).toBe(LOCAL_GRAPH_BOUNDS.north)
 expect(Math.min(...nodes.map(n=>n.longitude))).toBe(LOCAL_GRAPH_BOUNDS.west)
 expect(Math.max(...nodes.map(n=>n.longitude))).toBe(LOCAL_GRAPH_BOUNDS.east)
})
