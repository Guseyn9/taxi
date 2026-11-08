// Local HTTP contract fixture; never connects to the production API.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,expect}=require('@playwright/test');
const output=path.resolve(process.env.RECOVERY_QA_OUTPUT||'/tmp/taxi-command-recovery-qa');
const root=path.join(output,'fixture');fs.mkdirSync(path.join(output,'screenshots'),{recursive:true});fs.mkdirSync(path.join(output,'logs'),{recursive:true});
let state,status,posts,reads,forbidden;
function reset(){state='Водитель прибыл';status='PROCESSING';posts=0;reads=0;forbidden=false}reset();
const server=http.createServer((request,response)=>{
 const url=new URL(request.url,'http://localhost');const json=(body,code=200)=>{response.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(body))};
 if(request.method==='POST'&&url.pathname==='/api/commands/taxi/order/42'){posts++;request.resume();return json({accepted:true,duplicate:false,instanceId:91,status:'PENDING',intent:'ride_started'},202)}
 if(request.method==='GET'&&url.pathname==='/api/commands/91'){reads++;return forbidden?json({message:'Forbidden'},403):json({instanceId:91,status,...status==='FAILED'?{errorCode:'TEST_EXECUTION_REJECTED'}:{}})}
 if(request.method==='GET'&&url.pathname==='/test/order')return json({state});
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);return response.end()}
 const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
 response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(response);
});
const errors=[],rows=[];
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch();
 try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base);await page.getByTestId('start-command').click();await expect.poll(()=>posts).toBe(1);await expect.poll(()=>reads).toBeGreaterThan(0);
 await page.reload();await expect(page.getByTestId('command-recovery')).toContainText('Проверяем предыдущее действие');await expect(page.getByTestId('start-command')).toBeDisabled();
 await page.screenshot({path:path.join(output,'screenshots','recovery-after-reload-390.png')});
 status='COMPLETED';state='Поездка началась';await expect(page.getByTestId('command-recovery')).toContainText('Действие выполнено');await expect(page.getByTestId('order-state')).toContainText('Поездка началась');
 assert.equal(posts,1);rows.push({scenario:'physical reload after acceptance',posts,reads,order:state});
 await page.screenshot({path:path.join(output,'screenshots','recovery-completed-390.png')});await page.getByRole('button',{name:'Понятно'}).click();await expect(page.getByTestId('command-recovery')).toHaveCount(0);await context.close();
 reset();forbidden=true;
 const context2=await browser.newContext({viewport:{width:390,height:844}}),page2=await context2.newPage();page2.on('pageerror',error=>errors.push(error.message));
 await page2.goto(base);await page2.getByTestId('start-command').click();await expect(page2.getByTestId('command-recovery')).toContainText('Результат действия ещё не подтверждён');
 for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1440,height:900}]){
 await page2.setViewportSize(size);await page2.screenshot({path:path.join(output,'screenshots',`recovery-unconfirmed-${size.width}x${size.height}.png`)});
 const metrics=await page2.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.command-recovery button')].map(button=>{const r=button.getBoundingClientRect();return{x:r.x,right:r.right,height:r.height}})}));
 assert.ok(metrics.scrollWidth<=size.width);for(const button of metrics.buttons){assert.ok(button.height>=44&&button.x>=0&&button.right<=size.width)}rows.push({scenario:'responsive unconfirmed action',size,metrics});
 }
 const before=reads;await page2.getByRole('button',{name:'Проверить результат'}).click();await expect.poll(()=>reads).toBe(before+1);await expect(page2.getByRole('button',{name:'Проверить результат'})).toBeVisible();assert.equal(posts,1);
 forbidden=false;status='COMPLETED';state='Поездка началась';await page2.getByRole('button',{name:'Проверить результат'}).click();await expect(page2.getByTestId('command-recovery')).toContainText('Действие выполнено');assert.equal(posts,1);rows.push({scenario:'lookup failure and manual status retry',posts,reads});await context2.close();
 reset();const context3=await browser.newContext({viewport:{width:390,height:844}}),page3=await context3.newPage();page3.on('pageerror',error=>errors.push(error.message));
 await page3.goto(base);await page3.getByTestId('start-command').click();await expect.poll(()=>posts).toBe(1);await expect.poll(()=>reads).toBeGreaterThan(0);await page3.reload();status='FAILED';
 await expect(page3.getByTestId('command-recovery')).toContainText('Действие не выполнено');await expect(page3.getByTestId('order-state')).toContainText('Водитель прибыл');assert.equal(posts,1);await page3.screenshot({path:path.join(output,'screenshots','recovery-failed-390.png')});rows.push({scenario:'execution failure does not advance the trip',posts,reads,order:state});await context3.close();
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(output,'logs','recovery-browser.json'),JSON.stringify({fixture:'isolated HTTP contract, not production backend acceptance',rows,errors},null,2))}
 console.log(JSON.stringify({passed:rows.length,errors,output}));
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
