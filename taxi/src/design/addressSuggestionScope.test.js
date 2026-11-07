import {scopeAddressSuggestions} from './addressSuggestionScope'
import {ESuggestionType} from '../types/types'
const legacy={type:ESuggestionType.PointUnofficial,point:{address:'Accra'}}
const personal={type:ESuggestionType.PointUserTop,point:{address:'Agadir',latitude:30.4,longitude:-9.6}}
const map={type:ESuggestionType.PointOfficial,point:{address:'Place',latitude:30.4,longitude:-9.6}}
test('legacy unlocated Ghana strings are not presented as a Morocco dictionary',()=>{
 expect(scopeAddressSuggestions([legacy,personal,map],{latitude:30.4,longitude:-9.6})).toEqual([personal,map])
 expect(scopeAddressSuggestions([legacy],{latitude:5.5,longitude:-0.2})).toEqual([legacy])
})
