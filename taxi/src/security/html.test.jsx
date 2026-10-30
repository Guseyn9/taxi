import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import HTML from '../components/HTML'
import {sanitizeHtml} from './html'

test.each([
 '<img src=x onerror="window.__htmlPwned=1"><script>window.__htmlPwned=1</script>',
 '<svg><g onload=alert(1)></g><foreignObject><iframe srcdoc="<script>alert(1)</script>"></iframe></foreignObject></svg>',
 '<a href="java&#x73;cript:alert(1)" onclick="alert(1)">link</a>',
 '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
 '<form id=location><input name=href></form><span style="position:fixed" id=constructor>text</span>',
])('sanitizes active HTML at the shared renderer boundary',async input=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host)
 await act(async()=>root.render(<HTML html={input}/>))
 expect(host.querySelector('script,iframe,svg,math,form,input,style,object,embed')).toBeNull()
 for(const element of Array.from(host.querySelectorAll('*')))for(const attr of Array.from(element.attributes)){
  expect(attr.name).not.toMatch(/^on|^id$|^name$/i)
  if(['href','src'].includes(attr.name))expect(attr.value.replace(/\s/g,'')).not.toMatch(/^javascript:/i)
 }
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
test('retains useful terms links/formatting while forbidding active content in checkbox labels',()=>{
 expect(sanitizeHtml('<b>Accept</b> <a href="https://example.com/terms" target="_blank">terms</a>',true)).toBe('<b>Accept</b> <a href="https://example.com/terms">terms</a>')
 expect(sanitizeHtml('<div>Text</div><img src=x onerror=alert(1)>',true)).toBe('Text')
})
