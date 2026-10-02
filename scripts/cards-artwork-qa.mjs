import { chromium } from 'playwright';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.env.CARDS_QA_URL??'http://127.0.0.1:4322';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('QA solo local.');
const out='review/altaria-cards/cr80';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PW_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const report=[];
try{
 const ctx=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'});await ctx.route('https://**/*',r=>r.abort());
 // Regression: a hidden preview whose decode never settles must not block selection.
 await ctx.addInitScript(()=>{
  const decode=HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode=function(){
   return this.hasAttribute('data-artwork-preview')?new Promise(()=>{}):decode.call(this);
  };
 });
 const saved=new Map();let counter=0;
 await ctx.route('**/api/tarjetas/diseno',async r=>{
  const request=r.request();const body=await new Response(request.postDataBuffer(),{headers:{'content-type':request.headers()['content-type']}}).formData();
  const file=body.get('file'),bytes=Buffer.from(await file.arrayBuffer()),meta=await sharp(bytes).metadata(),layout=JSON.parse(body.get('layout'));
  const status=meta.width<1012||meta.height<638||Math.abs(meta.width/meta.height/(85.6/53.98)-1)>.02||layout.fit==='cover'?'review':'ready';
  const token=(++counter).toString(16).padStart(64,'0'),data={token,filename:file.name,width:meta.width,height:meta.height,status,layout};
  saved.set(token,{bytes,data});await r.fulfill({status:201,contentType:'application/json',body:JSON.stringify(data)});
 });
 await ctx.route('**/api/tarjetas/diseno/*',async r=>{
  const token=new URL(r.request().url()).pathname.split('/').at(-1),record=saved.get(token);
  if(r.request().method()==='DELETE'){saved.delete(token);return r.fulfill({status:204});}
  return record?r.fulfill({status:200,contentType:'image/png',body:record.bytes}):r.fulfill({status:404,body:'Not found'});
 });
 const page=await ctx.newPage();await page.goto(`${base}/tarjetas-nfc-personalizadas#comprar`,{waitUntil:'networkidle'});
 const cookie=page.getByRole('button',{name:'Solo necesarias',exact:true});if(await cookie.isVisible())await cookie.click();
 await page.locator('[name="design"][value="own"]').check();
 const modal=page.locator('[data-artwork-modal]'),input=page.locator('[data-artwork-input]'),save=page.locator('[data-artwork-save]');
 for(const [w,h,status] of [[1012,638,'ready'],[1016,638,'ready'],[5060,3190,'ready'],[1000,1000,'review'],[400,250,'review']]){
  if(!await modal.isVisible())await page.locator('[data-open-artwork]').first().click();
  const bytes=await sharp({create:{width:w,height:h,channels:3,background:'#016ffc'}}).png().toBuffer();
  await input.setInputFiles({name:`design-${w}.png`,mimeType:'image/png',buffer:bytes});
  await page.waitForFunction(([w,h])=>document.querySelector('[data-artwork-status]').textContent.includes(`${w} × ${h}`),[w,h]);
  assert.equal(await save.innerText(),status==='review'?'Enviar para revisión':'Guardar diseño');
  if(status==='review')await modal.screenshot({path:`${out}/review-${w}.png`});
  await save.click();await modal.waitFor({state:'hidden'});
  const latest=[...saved.values()].at(-1);assert.deepEqual(latest.bytes,bytes);assert.equal(saved.size,1);
  report.push({w,h,status,originalUnchanged:true});
 }
 await page.locator('[data-open-artwork]').first().click();
 await input.setInputFiles({name:'huge.png',mimeType:'image/png',buffer:Buffer.alloc(2*1024*1024+1)});assert.equal(await save.isDisabled(),true);
 await input.setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});assert.equal(await save.isDisabled(),true);
 const bytes=await sharp({create:{width:1012,height:638,channels:3,background:'#016ffc'}}).png().toBuffer();
 await input.setInputFiles({name:'crop.png',mimeType:'image/png',buffer:bytes});
 await page.locator('[name="artworkFit"][value="cover"]').check();await page.locator('[data-artwork-x]').fill('75');
 assert.equal(await save.innerText(),'Enviar para revisión');await save.click();await modal.waitFor({state:'hidden'});
 assert.equal([...saved.values()][0].data.layout.x,75);
 await page.reload({waitUntil:'networkidle'});await page.locator('[data-open-artwork]').first().click();
 assert.equal(await page.locator('[name="artworkFit"][value="cover"]').isChecked(),true);
 await page.keyboard.press('Escape');await page.locator('[data-next]').click();await page.locator('[data-back]').click();
 assert.equal(await page.locator('[data-next]').isEnabled(),true);
 await page.locator('[data-open-artwork]').first().click();await page.locator('[data-artwork-remove]').click();
 await page.waitForFunction(()=>document.querySelector('[data-artwork-status]').textContent.includes('eliminado'));
 assert.equal(saved.size,0);await page.keyboard.press('Escape');assert.equal(await page.locator('[data-next]').isDisabled(),true);
 await page.locator('[name="design"][value="custom"]').check();assert.equal(await page.locator('[data-next]').isEnabled(),true);
 await page.setViewportSize({width:1440,height:1000});await page.locator('[name="design"][value="own"]').check();
 await input.setInputFiles({name:'desktop.png',mimeType:'image/png',buffer:bytes});await modal.screenshot({path:`${out}/desktop.png`});
 report.push({oversize:'blocked',unsupported:'blocked',back:'preserved',replace:'old-unbound-removed',delete:'removed',withoutDesign:'custom-continues',crop:'manual-only-persisted'});
 console.log('PASS CR80 dimensions, review, original integrity, fit/crop, replace, delete, back, reload, no-design.');
}finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
