import {createSelector} from 'reselect'
import {IArea} from '../../types/types'
import {IWayGraph,WayGraph} from '../../tools/maps'
import {preparedGraphView} from '../../graph/view'
import {PackedGraphData} from '../../graph/packed'
import {MergedWayGraph} from '../../graph/merged'
import {IRootState} from '../'
import {moduleName,IAreasState} from './constants'
export const moduleSelector=(state:IRootState)=>state[moduleName]
export const areas=createSelector(moduleSelector,state=>state.areas)
export const area=createSelector([areas,(_state:IRootState,id:IArea['id'])=>id],(values,id)=>values[id])
let latestAreas:IAreasState['areas']|undefined
let latestWayGraph:IWayGraph=new WayGraph()
const legacyViews=new WeakMap<IArea,IWayGraph>()
export function wayGraph(state:IRootState):IWayGraph {
 const current=areas(state)
 if(current===latestAreas)return latestWayGraph
 const graphs=Object.values(current).map(item=>{
  const packet=(item as IArea&{preparedGraph?:PackedGraphData}).preparedGraph
  if(packet)return preparedGraphView(packet)
  let graph=legacyViews.get(item)
  if(!graph){graph=new WayGraph(undefined,item);legacyViews.set(item,graph)}
  return graph
 })
 latestAreas=current
 latestWayGraph=graphs.length===1?graphs[0]:graphs.length?new MergedWayGraph(graphs):new WayGraph()
 return latestWayGraph
}
