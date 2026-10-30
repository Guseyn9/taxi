import React from 'react'
import Popper from '@mui/material/Popper'
import './suggestion-layer.css'
const modifiers=[
 {name:'offset',options:{offset:[0,6]}},
 {name:'flip',options:{padding:8}},
 {name:'preventOverflow',options:{padding:8}},
 {name:'sameWidth',enabled:true,phase:'beforeWrite' as const,requires:['computeStyles'],fn:({state}:any)=>{state.styles.popper.width=`${state.rects.reference.width}px`}},
]
/** Portal keeps autocomplete outside the sheet's scroller without resizing it. */
export default function SuggestionLayer({floating,anchor,open,children}:{floating:boolean,anchor:HTMLElement|null,open:boolean,children:React.ReactNode}){
 if(!floating)return <>{children}</>
 return <Popper role="presentation" open={open&&Boolean(anchor)} anchorEl={anchor} placement="bottom-start" popperOptions={{strategy:'fixed'}} modifiers={modifiers} className="rs-address-suggestions-popup" dir={anchor?.closest('[dir]')?.getAttribute('dir')||undefined}>{children}</Popper>
}
