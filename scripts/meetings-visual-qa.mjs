import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { assertLocalQaUrl } from './lib/local-qa-url.mjs';
const base=process.env.MEETING_QA_URL || 'http://127.0.0.1:4322';assertLocalQaUrl(base);
const output='review/meetings';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={layouts:[],states:[],errors:[],accessibility:[]};
const slots=['2026-10-29','2026-10-30','2026-11-02'].flatMap(day=>['10:00','10:45','11:30','12:15','13:00','16:00','16:45','17:30'].map(time=>{
  const start=new Date(`${day}T${time}:00+01:00`).toISOString();return {day,time,start,end:new Date(Date.parse(start)+1800000).toISOString()};
}));
const booking={id:'SYNTHETIC-QA-NO-REAL-BOOKING',status:'confirmed',start:slots[0].start,end:slots[0].end,timezone:'Europe/Madrid',meetUrl:'https://meet.google.com/abc-defg-hij'};
try{
  for(const width of [1440,768,390,320]){
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
    await context.route('https://**/*',route=>route.abort());
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(`${base}/agendar-reunion`,{waitUntil:'networkidle'});
    if(await page.locator('[data-cookie-reject]').isVisible())await page.locator('[data-cookie-reject]').click();
    await page.locator('[data-unavailable]').waitFor({state:'visible'});
    assert.equal((await page.request.get(`${base}/api/reuniones/recuperar`)).status(),401);
    await page.screenshot({path:`${output}/${width}-unconfigured.png`,fullPage:true});
    await page.route('**/api/reuniones/disponibilidad',route=>route.fulfill({json:{slots,timezone:'Europe/Madrid',duration:30}}));
    await page.locator('[data-reload]').click();await page.locator('[data-times] button').first().waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`${output}/${width}-calendar.png`,fullPage:true});
    const audit=await new AxeBuilder({page}).include('[data-meeting-booking]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    report.accessibility.push({width,violations:audit.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))});
    await page.locator('[data-times] button').first().click();await page.locator('[data-to-form]').click();
    await page.locator('[data-form] button[type=submit]').click();assert.equal(await page.locator('[name=name]').getAttribute('aria-invalid'),'true');
    await page.locator('[name=name]').fill('Cliente de prueba');await page.locator('[name=business]').fill('Negocio sintético');
    await page.locator('[name=email]').fill('qa@example.test');await page.locator('[name=phone]').fill('+1 202 555 0123');
    await page.locator('[name=comment]').fill('Prueba visual. No se crea una reunión real.');await page.locator('[name=privacy]').check();
    await page.screenshot({path:`${output}/${width}-form.png`,fullPage:true});
    await page.locator('[data-form] button[type=submit]').click();await page.locator('[data-step=review]').waitFor({state:'visible'});
    await page.screenshot({path:`${output}/${width}-review.png`,fullPage:true});
    let submissions=0;
    await page.route('**/api/reuniones/reservar',async route=>{submissions++;const body=route.request().postDataJSON();assert.equal(body.phone,'+1 202 555 0123');assert.ok(body.token.length===64);await route.fulfill({json:{booking:{...booking,status:'pending',meetUrl:null}}});});
    await page.route('**/api/reuniones/estado',route=>route.fulfill({json:{booking}}));
    await page.locator('[data-submit]').click();await page.locator('[data-step=result]').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-meet]').isVisible(),false);await page.screenshot({path:`${output}/${width}-pending.png`,fullPage:true});
    await page.locator('[data-status]').click();await page.locator('[data-meet]').waitFor({state:'visible'});assert.equal(submissions,1);
    await page.screenshot({path:`${output}/${width}-confirmed.png`,fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.reload({waitUntil:'networkidle'});await page.locator('[data-meet]').waitFor({state:'visible'});assert.equal(submissions,1);
    report.layouts.push({width,overflow:false,resumeWithoutResubmit:true});
    if(width===390){
      await page.evaluate(()=>sessionStorage.clear());await page.unroute('**/api/reuniones/disponibilidad');
      await page.route('**/api/reuniones/disponibilidad',route=>route.fulfill({json:{slots:[],timezone:'Europe/Madrid',duration:30}}));
      await page.reload({waitUntil:'networkidle'});await page.locator('[data-unavailable]').waitFor({state:'visible'});await page.screenshot({path:`${output}/390-empty.png`,fullPage:true});report.states.push('empty');
    }
    await context.close();
  }
  report.states.push('unconfigured','calendar','invalid-fields','form','review','pending','confirmed','resume');
  writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));
  assert.equal(report.errors.length,0);assert.equal(report.accessibility.flatMap(a=>a.violations).length,0);
  console.log(JSON.stringify(report));
}finally{await browser.close();}
