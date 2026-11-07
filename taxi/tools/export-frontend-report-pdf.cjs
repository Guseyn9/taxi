'use strict'
// Export the existing curated HTML, not raw Playwright reports or auth artifacts.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http')
const {chromium}=require('@playwright/test')
const root=path.resolve(__dirname,'..'),source=path.join(root,'docs/qa/frontend-completion-20261103/frontend-report.html')
const output=path.resolve(process.env.REPORT_PDF_OUTPUT||path.join(root,'output/pdf/frontend-report.pdf'))
const fonts=new Set(['manrope-latin.woff2','manrope-latin-ext.woff2','manrope-cyrillic.woff2','manrope-cyrillic-ext.woff2'])
const server=http.createServer((req,res)=>{
  if(req.url==='/report'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});fs.createReadStream(source).pipe(res);return}
  const name=req.url?.replace(/^\/fonts\//,'')
  if(fonts.has(name)){res.writeHead(200,{'Content-Type':'font/woff2'});fs.createReadStream(path.join(root,'public/fonts',name)).pipe(res);return}
  res.writeHead(404);res.end()
})
;(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  let browser
  const tmp=output+'.pending.pdf'
  try {
    browser=await chromium.launch()
    const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    const origin=`http://127.0.0.1:${server.address().port}`
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort())
    await page.goto(origin+'/report')
    await page.emulateMedia({media:'print'})
    await page.addStyleTag({content:`
      @font-face{font-family:Manrope;src:url('${origin}/fonts/manrope-cyrillic.woff2') format('woff2');font-weight:200 800;unicode-range:U+0400-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F}
      @font-face{font-family:Manrope;src:url('${origin}/fonts/manrope-latin.woff2') format('woff2');font-weight:200 800;unicode-range:U+0000-00FF,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212}
      @page{size:A4 landscape;margin:14mm 15mm 17mm}
      *{box-sizing:border-box}body{font-family:Manrope,Arial,sans-serif!important;font-size:10.5pt;line-height:1.4;background:#fff!important;color:#111}
      main{max-width:none;padding:0;margin:0}h1{font-size:24pt;line-height:1.15;break-after:avoid}h2{font-size:15pt;line-height:1.2;margin:17pt 0 9pt;break-after:avoid}h3{font-size:12pt;break-after:avoid}
      p,li{orphans:3;widows:3}p{margin:7pt 0}li{margin:5pt 0}code{font-size:8pt;overflow-wrap:anywhere}a{color:#9c151f}
      #filter{display:none}.scores{gap:10pt}.score{padding:10pt}.score strong{font-size:24pt}
      table{width:100%;font-size:8.5pt;line-height:1.3;table-layout:fixed}th,td{padding:7pt;overflow-wrap:anywhere}thead th:first-child{width:24%}thead th:last-child{width:76%}#registry thead th:first-child{width:8%}#registry thead th:nth-child(2){width:50%}#registry thead th:last-child{width:42%}.cjm-summary{font-size:10pt;margin-top:14pt}.cjm-summary thead th:first-child{width:16%}.cjm-summary thead th:nth-child(2),.cjm-summary thead th:last-child{width:42%}tr{break-inside:avoid}thead{display:table-header-group}td p{margin:4pt 0}
      details{padding:0;border:0}summary{font-size:13pt;break-after:avoid;margin:12pt 0 8pt}
      .gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10pt}.gallery figure{break-inside:avoid;padding:4pt}
      figure img{display:block;max-height:130mm;width:auto;max-width:100%;object-fit:contain;margin:0 auto}figcaption{font-size:9pt;line-height:1.3;padding:7pt}
      .gallery.wide{display:block;break-before:avoid}.gallery.wide figure{break-after:page;margin:0;width:100%;border:0}
      .gallery.wide figure img{max-height:146mm;max-width:255mm;width:auto}.gallery.wide figure:first-child img{max-height:125mm}.gallery.wide figcaption{font-size:10pt;color:#111}
      #toolchain-followup,#style-pipeline-followup,#driver-map-followup{display:none}
    `})
    await page.evaluate(async()=>{
      document.querySelectorAll('details').forEach(d=>d.open=true)
      document.querySelectorAll('img').forEach(i=>i.loading='eager')
      document.querySelector('a[href="/review/frontend-report.pdf"]')?.parentElement?.remove()
      document.querySelectorAll('a[href^="/"]').forEach(a=>a.href='https://taxi-morocco-frontend.vercel.app'+a.getAttribute('href'))
      document.querySelectorAll('table').forEach(table=>{
        const first=table.rows[0]
        if(first?.querySelector('th')&&!table.tHead)table.createTHead().appendChild(first)
      })
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT)
      while(walker.nextNode())walker.currentNode.nodeValue=walker.currentNode.nodeValue.replace(/[\u2010-\u2015]/g,'-')
      await document.fonts.ready
      if(!document.fonts.check('400 12px Manrope','Проверка Report'))throw Error('Report font did not load')
      await Promise.race([Promise.all(Array.from(document.images,i=>i.decode())),new Promise((_,reject)=>setTimeout(()=>reject(Error('Report image decoding timed out')),20000))])
    })
    if(errors.length)throw Error('Report page errors: '+errors.join('; '))
    fs.mkdirSync(path.dirname(output),{recursive:true})
    await page.pdf({path:tmp,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;padding:0 15mm;font:9px Arial;color:#555;display:flex;justify-content:space-between"><span>Taxi Morocco - проверка фронтенда - локальный стенд, не приёмка production</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'})
    fs.renameSync(tmp,output)
    console.log(JSON.stringify({output,bytes:fs.statSync(output).size,visualReviewRequired:true}))
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));if(fs.existsSync(tmp))fs.rmSync(tmp)}
})().catch(error=>{console.error(error.stack);process.exitCode=1})
