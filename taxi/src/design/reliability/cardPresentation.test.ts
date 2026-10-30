import {cardPresentation} from './cardPresentation'
it('terminal cards show the final state instead of a live voting state',()=>{
 expect(cardPresentation({b_state:4},'ru')).toMatchObject({terminal:true,label:'Завершён'})
 expect(cardPresentation({b_state:'3'},'en')).toMatchObject({terminal:true,label:'Cancelled'})
 expect(cardPresentation({b_completed:true},'fr')).toMatchObject({terminal:true,label:'Terminé'})
 expect(cardPresentation({b_state:1},'ru')).toMatchObject({terminal:false,label:undefined})
})
it('labels a local route estimate as duration, never promised pickup time',()=>{
 for(const iso of ['ru','en','fr','ar'])expect(cardPresentation({},iso).duration.length).toBeGreaterThan(0)
 expect(cardPresentation({},'ru').duration).toBe('Расчётная длительность маршрута')
})
