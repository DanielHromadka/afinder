// Disposable Electron integration, real offline Laya. AFINDER_LAYA_CACHE must point to verified model assets.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afinder-assistant-smoke-'));
const folder = path.join(directory,'work');fs.mkdirSync(folder);
const invoice=path.join(folder,'invoice_acme_october.txt');fs.writeFileSync(invoice,'Invoice ACME October. Amount due EUR 200. Customer accounting document.');
fs.mkdirSync(path.join(folder,'Invoices'));fs.writeFileSync(path.join(folder,'Invoices',path.basename(invoice)),'existing invoice must survive');
fs.mkdirSync(path.join(folder,'Photos'));fs.mkdirSync(path.join(folder,'handoff'));
fs.writeFileSync(path.join(directory,'settings.json'),JSON.stringify({language:'en',autoUpdate:false,lastPath:folder}));
app.setPath('userData',directory);
let exitCode=0;
app.once('will-quit',()=>{fs.rmSync(directory,{recursive:true,force:true});app.exit(exitCode)});
const root=process.env.AFINDER_APP_ROOT || path.resolve(__dirname,'..');require(path.join(root,'out/main/index.js'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,message,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const v=await check();if(v)return v;await sleep(50)}throw new Error(message)}
app.whenReady().then(async()=>{
 try {
  const win=await until(async()=>{const w=BrowserWindow.getAllWindows()[0];return w&&!w.webContents.isLoading()&&await w.webContents.executeJavaScript('!!window.api && !!document.querySelector(".toolbar")')?w:false},'Render timeout');
  const js=code=>win.webContents.executeJavaScript(code);
  assert.equal((await js('window.api.getSettings()')).fileAssistantEnabled,false);
  assert.equal((await js('window.api.getSettings()')).fileAssistantReadContent,false);
  assert.equal(fs.existsSync(path.join(directory,'file-assistant')),false);
  await js('document.querySelector(\'button[title="Settings"]\').click()');
  await until(()=>js('!!document.querySelector("dialog.settings-dialog[open]")'),'Settings timeout');
  await js('Array.from(document.querySelectorAll(".settings-check")).find(el=>el.textContent.includes("Enable local file assistant")).querySelector("input").click()');
  await until(async()=> (await js('window.api.getSettings()')).fileAssistantEnabled,'Enable failed');
  assert.equal(fs.existsSync(path.join(directory,'file-assistant','model')),false,'Enabling must not download');
  await js('document.querySelector("dialog.settings-dialog .tb-close").click()');
  if(!process.env.AFINDER_LAYA_CACHE)throw new Error('Set AFINDER_LAYA_CACHE for real offline test');
  fs.mkdirSync(path.join(directory,'file-assistant'),{recursive:true});
  fs.cpSync(process.env.AFINDER_LAYA_CACHE,path.join(directory,'file-assistant','model'),{recursive:true,mode:fs.constants.COPYFILE_FICLONE});
  assert.equal((await js('window.api.fileAssistant.status()')).ready,true);
  const input={folder,paths:[invoice],mode:'organize',goal:'Organize accounting documents',candidates:[path.join(folder,'Invoices'),path.join(folder,'Photos')],categories:['Invoices','Photos','Other']};
  const start=performance.now();
  for(const mode of ['destination','organize','project','tags','application','search','placement','handoff']){
   const plan=await js(`window.api.fileAssistant.analyze(${JSON.stringify({...input,mode,goal:'Customer ACME invoices for accounting'})})`);
   assert.equal(plan.mode,mode);assert.equal(plan.rows.length,1);assert.ok(plan.choices.some(c=>c.id===plan.rows[0].choice));assert.ok(Number.isFinite(plan.rows[0].score));assert.equal(plan.rows[0].content,'metadata');assert.ok(fs.existsSync(invoice));
   console.log('PASS real mode',mode,plan.rows[0].choice,Math.round(plan.rows[0].score*100));
  }
  console.log('Real eight-mode model time ms',Math.round(performance.now()-start));
  const czech=path.join(folder,'faktura_zakaznik_rijen.txt');fs.writeFileSync(czech,'Faktura za služby pro zákazníka. Částka k úhradě 200 EUR. Účetní doklad.');
  await js('window.api.setSettings({fileAssistantReadContent:true})');
  const csPlan=await js(`window.api.fileAssistant.analyze(${JSON.stringify({...input,paths:[czech],mode:'organize',goal:'Roztřiď účetní doklady a fotografie',categories:['Faktury','Fotografie','Ostatní']})})`);
  assert.equal(csPlan.rows[0].content,'text');assert.ok(csPlan.choices.some(c=>c.id===csPlan.rows[0].choice));console.log('Czech invoice decision',csPlan.rows[0].choice,Math.round(csPlan.rows[0].score*100),'review',csPlan.rows[0].review);if(csPlan.rows[0].choice!==csPlan.choices[0].id)assert.equal(csPlan.rows[0].review,true,'Uncertain Czech fixture must remain for review');fs.unlinkSync(czech);
  await js('window.api.setSettings({fileAssistantReadContent:false})');
  console.log('PASS real Czech text input and review/abstention handling');
  // Open the real dialog through the visible context menu.
  await js('document.querySelector(".filelist-scroll").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:400,clientY:250}))');
  await until(()=>js('Array.from(document.querySelectorAll(".menu-item")).some(b=>b.textContent.includes("Local file assistant"))'),'Context entry missing');
  await js('Array.from(document.querySelectorAll(".menu-item")).find(b=>b.textContent.includes("Local file assistant")).click()');
  await until(()=>js('!!document.querySelector(".submenu")'),'Submenu missing');
  await js('Array.from(document.querySelectorAll(".submenu .menu-item")).find(b=>b.textContent.includes("Organize this folder")).click()');
  await until(()=>js('!!document.querySelector("dialog.file-assistant-dialog[open]")'),'Assistant dialog missing');
  await js('Array.from(document.querySelectorAll(".file-assistant-dialog button")).find(b=>b.textContent==="Prepare suggestions").click()');
  await until(()=>js('!!document.querySelector(".assistant-row")'),'Preview missing',90000);
  assert.ok(fs.existsSync(invoice),'Analysis must not move source');
  fs.writeFileSync('/tmp/afinder-assistant-preview.png',(await win.webContents.capturePage()).toPNG());
  await js('(()=>{const r=document.querySelector(".assistant-row"),box=r.querySelector("input[type=checkbox]");if(!box.checked)box.click();const s=r.querySelector("select");const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set;setter.call(s,Array.from(s.options).find(o=>o.textContent==="Invoices").value);s.dispatchEvent(new Event("change",{bubbles:true}))})()');
  await js('Array.from(document.querySelectorAll(".file-assistant-dialog button")).find(b=>b.textContent==="Move selected files").click()');
  await until(()=>js('!!document.querySelector(".file-assistant-dialog [role=status]")'),'Apply missing',30000);
  assert.equal(fs.existsSync(invoice),false);assert.equal(fs.readFileSync(path.join(folder,'Invoices',path.basename(invoice)),'utf8'),'existing invoice must survive');
  const copied=fs.readdirSync(path.join(folder,'Invoices')).filter(n=>n!==path.basename(invoice));assert.equal(copied.length,1);assert.ok(fs.readFileSync(path.join(folder,'Invoices',copied[0]),'utf8').includes('EUR 200'));
  const image=await win.webContents.capturePage();fs.writeFileSync('/tmp/afinder-assistant-smoke.png',image.toPNG());
  await js('document.querySelector(".file-assistant-dialog .tb-close").click()');
  const current=path.join(folder,'Invoices',copied[0]);const tags=await js(`window.api.fileAssistant.analyze(${JSON.stringify({...input,folder:path.dirname(current),paths:[current],mode:'tags'})})`);
  const tagsResult=await js(`window.api.fileAssistant.apply(${JSON.stringify({planId:tags.id,operation:'tags',edits:[{path:current,choice:tags.choices[0].id,selected:true}]})})`);assert.equal(tagsResult.completed.length,1);
  assert.ok(fs.existsSync(path.join(directory,'file-assistant','tags.json')));await js('window.api.fileAssistant.clearTags()');assert.equal(fs.existsSync(path.join(directory,'file-assistant','tags.json')),false);
  await js('window.api.setSettings({fileAssistantEnabled:false})');assert.equal((await js('window.api.fileAssistant.status()')).enabled,false);
  console.log('PASS Settings opt-in, no automatic download, actual CPU model, eight modes, editable UI preview, confirmed move with collision preservation, local tags and disable');
 }catch(e){exitCode=1;console.error(e)}finally{app.quit()}
});
