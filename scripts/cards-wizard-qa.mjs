import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const artworkFixture = await sharp({create:{width:1016,height:638,channels:3,background:'#016ffc'}}).png().toBuffer();
const base = process.env.CARDS_QA_URL ?? 'http://127.0.0.1:4322';
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Solo QA local aislada.');
const out = 'review/altaria-cards/whatsapp-catalog'; mkdirSync(out,{recursive:true});
const report = {branches:[],layouts:[],checks:[],errors:[]};
const browser = await chromium.launch({headless:true,executablePath:process.env.PW_CHROME || undefined});
const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await ctx.route('https://**/*',r=>r.abort());
await ctx.route('https://wa.me/**',r=>r.fulfill({status:200,body:'WhatsApp interceptado en QA. No se envía ningún mensaje.'}));
await ctx.route('https://checkout.stripe.com/**',r=>r.fulfill({status:200,body:'Checkout simulado. Sin cobros.'}));
await ctx.route('**/api/tarjetas/checkout',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_qa'})}));
await ctx.route('**/api/tarjetas/diseno',r=>r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({token:'a'.repeat(64),filename:'card.png',width:1016,height:638,status:'ready'})}));
await ctx.route('**/api/tarjetas/consulta',r=>r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:'inquiry-qa',saved:true})}));
const page=await ctx.newPage(); page.on('pageerror',e=>report.errors.push(e.message));
const posts=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/tarjetas/'))posts.push(r.url());});
const form=page.locator('[data-cards-config]');
const input=n=>form.locator(`[name="${n}"]`);
const choose=(n,v)=>form.locator(`[name="${n}"][value="${v}"]`).check();
const next=()=>form.locator('[data-next]').click();
async function start(){await page.goto(`${base}/tarjetas-nfc-personalizadas#comprar`,{waitUntil:'networkidle'});await page.evaluate(()=>sessionStorage.clear());await page.reload({waitUntil:'networkidle'});if(await page.locator('[data-cookie-reject]').isVisible())await page.locator('[data-cookie-reject]').click();await page.waitForFunction(()=>document.querySelector('[data-cards-config]')?.dataset.initialized==='true');}
try {
 await start();
 assert.equal(await page.locator('[data-cards-inquiry]').count(),0);
 assert.equal(await input('design').count(),2);
 assert.equal(await form.locator('[value="existing"]').count(),0);
 const contactLinks=await page.locator('a').evaluateAll(links=>links.filter(a=>a.textContent.includes('Cuéntanos tu idea')).map(a=>a.href));
 assert.ok(contactLinks.length>=3);for(const link of contactLinks)assert.equal(new URL(link).pathname,'/34619132563');
 for(const design of ['own','custom'])for(const product of ['resenas','redes-sociales','whatsapp','reservas','cartas-digitales','mi-web','contacto','acceso','otra-idea'])for(const destination of ['link','help','create']){
  await start();await choose('design',design);
  if(design==='own'){
   await page.locator('[data-artwork-input]').setInputFiles({name:'card.png',mimeType:'image/png',buffer:artworkFixture});
   await page.locator('[data-artwork-save]').click();await page.locator('[data-artwork-modal]').waitFor({state:'hidden'});
  }
  await next();await choose('productoId',product);await next();await choose('destination',destination);
  if(destination==='link')await input('url').fill('https://example.com/destino?a=1&b=2');
  if(destination==='help'){await input('helpBusiness').fill('Negocio QA');await input('locality').fill('Madrid');}
  if(destination==='create')await input('project').fill('Una página para presentar mi negocio.');
  if(destination!=='create'){
   if(product==='whatsapp'){await input('phone').fill('+34600000000');await input('message').fill('Hola, quiero información.');}
   if(product==='contacto')await input('name').fill('Contacto QA');
   if(['acceso','otra-idea'].includes(product))await input('otherProject').fill('Quiero conectar mi tarjeta a una experiencia.');
  }
  await next();await input('quantityPreset').selectOption('5');
  if(design==='custom')await input('style').fill('Azul y blanco');
  const direct = destination === 'link' || (destination === 'help' && !['acceso','otra-idea'].includes(product));
  if(direct || design==='own'){
   await input('negocioNombre').fill('Negocio QA'); await input('clienteNombre').fill('Cliente QA');
   await input('clienteEmail').fill('qa@example.com'); await input('clienteTelefono').fill('+34600000000');
  }
  await next();
  assert.equal(await form.locator('[data-shipping-fields]').isVisible(),direct);
  if(direct){
   assert.equal(await form.locator('[data-final-submit]').isEnabled(),false);
   await input('envioDireccion').fill('Calle Prueba 1');await input('envioCiudad').fill('Madrid');
   await input('envioProvincia').fill('Madrid');await input('envioCodigoPostal').fill('28001');await input('consent').check();
   assert.match(await form.locator('[data-summary="total"]').innerText(),design==='custom'? /100,00/:/90,00/);
   assert.match(await form.locator('[data-final-submit]').innerText(),/Comprar/);
   assert.equal(await form.locator('[data-final-submit]').isEnabled(),true);
   const req = page.waitForRequest(r=>r.url().includes('/api/tarjetas/checkout')&&r.method()==='POST');
   await form.locator('[data-final-submit]').click();const payload=(await req).postDataJSON();
   assert.equal(payload.personalizacion.configuracion.design,design);assert.equal(payload.cantidad,5);
   assert.equal(payload.personalizacion.tarifa,undefined);assert.equal(payload.amount,undefined);
   await page.waitForURL('https://checkout.stripe.com/**');
  }else{
   if(design==='own')await input('consent').check();
   assert.match(await form.locator('[data-final-submit]').innerText(),/Solicitar propuesta/);
   const preview=await form.locator('[data-whatsapp-preview]').inputValue();assert.match(preview,/Cantidad: 5/);
   await form.locator('[data-final-submit]').click();await page.waitForURL('https://wa.me/**');
   const url=new URL(page.url());assert.equal(url.pathname,'/34619132563');assert.equal(url.searchParams.get('text'),design==='own'?`${preview}\nReferencia de solicitud: inquiry-qa`:preview);
  }
  report.branches.push({design,product,destination,result:direct?'checkout-mocked':'whatsapp-intercepted'});
  console.log(`OK ${design}/${product}/${destination}`);
 }
 assert.equal(posts.filter(url=>url.includes('/checkout')).length,32);
 assert.equal(posts.filter(url=>url.endsWith('/diseno')).length,27);
 assert.equal(posts.filter(url=>url.endsWith('/consulta')).length,11);
 for(const width of [360,390,768,1024,1440,1920]){
  await page.setViewportSize({width,height:1000});await start();
  await page.locator('[data-open-catalog]').first().click();
  const dialog=page.locator('[data-cards-catalog]');assert.equal(await dialog.isVisible(),true);
  assert.equal(await dialog.locator('[data-example-id]:visible').count(),18);
  await dialog.locator('img').evaluateAll(async imgs=>{await Promise.all(imgs.map(async img=>{img.loading='eager';await img.decode();}));});
  assert.equal(await dialog.locator('img').evaluateAll(imgs=>imgs.every(img=>img.naturalWidth>0)),true);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1||document.querySelector('[data-cards-catalog]').scrollWidth>document.querySelector('[data-cards-catalog]').clientWidth+1);
  assert.equal(overflow,false);
  await page.screenshot({path:`${out}/catalog-${width}.png`});
  for(const category of ['resenas','redes-sociales','whatsapp','reservas','cartas-digitales','mi-web','contacto','acceso','otra-idea']){
   await dialog.locator(`[data-catalog-category="${category}"]`).click();assert.equal(await dialog.locator('[data-example-id]:visible').count(),2);
  }
  await dialog.locator('[data-catalog-category="all"]').click();
  await dialog.locator('[data-catalog-search]').fill('cafe');assert.equal(await dialog.locator('[data-example-id]:visible').count(),1);
  await dialog.locator('[data-catalog-search]').fill('zzzzzz');assert.equal(await dialog.locator('[data-catalog-empty]').isVisible(),true);
  await dialog.locator('[data-reset-catalog]').click();assert.equal(await dialog.locator('[data-example-id]:visible').count(),18);
  await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  await page.goto(base,{waitUntil:'networkidle'});if(await page.locator('[data-cookie-reject]').isVisible())await page.locator('[data-cookie-reject]').click();
  await page.locator('.ac-hero--home').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/home-${width}.png`});
  const sizes=await page.evaluate(()=>({cards:document.querySelector('.ac-hero--home .ac-shell').getBoundingClientRect().width,reference:document.querySelector('.case__inner').getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth+1}));
  assert.equal(sizes.overflow,false);if(width>=1200)assert.ok(Math.abs(sizes.cards-sizes.reference)<2);
  report.layouts.push({width,...sizes});console.log(`OK catálogo/home ${width}`);
 }
 await start();await page.locator('[data-card-example="redes-sociales"]').click();
 assert.equal(await page.locator('[data-example-id]:visible').count(),2);
 await page.locator('[data-configure-example="redes-estudio"]').click();
 assert.equal(await form.locator('[name="design"][value="custom"]').isChecked(),true);assert.match(await input('style').inputValue(),/Estudio Aura/);
 await page.reload({waitUntil:'networkidle'});assert.match(await input('style').inputValue(),/Estudio Aura/);
 report.checks.push('18 imágenes locales, 9 filtros, búsqueda sin tildes, sin resultados, reset, Escape, selección y borrador');
 report.checks.push('54 ramas: 32 Checkout simulados y 22 propuestas WhatsApp; sin cobros, escrituras remotas ni mensajes reales');
 assert.deepEqual(report.errors,[]);
} catch(e){report.errors.push(e.stack);throw e;}finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
