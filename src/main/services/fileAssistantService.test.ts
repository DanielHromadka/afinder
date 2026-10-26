import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FileAssistantService } from './fileAssistantService'
import type { DecisionProvider } from './fileAssistantModel'
import { ASSISTANT_MODES, type AssistantRequest, type DecisionInput } from '@shared/fileAssistant'
const dirs: string[] = [], services: FileAssistantService[] = []
const options = { fileAssistantEnabled: true, fileAssistantReadContent: false }
function setup(patch = {}) {
  const folder = mkdtempSync(path.join(os.tmpdir(),'afinder-assistant-test-')); dirs.push(folder)
  const file = path.join(folder,'invoice.txt'); writeFileSync(file,'SECRET Invoice ACME EUR 200')
  const target = path.join(folder,'Project'); mkdirSync(target)
  const model: DecisionProvider = { ready: vi.fn(() => true), download: vi.fn(async () => {}), stop: vi.fn(), decide: vi.fn(async (input: DecisionInput) => ({ choice: input.choices[0].id, score: .9, probabilities: input.choices.map((_,i) => i ? .1/(input.choices.length-1) : .9), truncated:false, collapsed:false })) }
  const transfer = vi.fn(async (sources: string[], dest: string, mode: 'move'|'copy') => { const p = path.join(dest,path.basename(sources[0])); await fs.copyFile(sources[0],p,fs.constants.COPYFILE_EXCL); if (mode==='move') await fs.unlink(sources[0]); return [p] })
  const openApplication = vi.fn(async () => {})
  const assertLocal = vi.fn(async () => {})
  const service = new FileAssistantService(path.join(folder,'data','tags.json'),{...options,...patch},model,{ assertLocal, transfer, applications: async () => [{id:'default',label:'Default',description:'System application'}],openApplication,changed:vi.fn() }); services.push(service)
  const request: AssistantRequest = {folder,paths:[file],mode:'organize',goal:'',candidates:[target],categories:['Invoices','Other']}
  return { service,model,folder,file,target,request,transfer,openApplication,assertLocal }
}
afterEach(() => { services.splice(0).forEach(s => s.dispose()); dirs.splice(0).forEach(p => rmSync(p,{recursive:true,force:true})) })
describe('opt-in local file assistant', () => {
  it('does no work or downloads while disabled',async () => {
    const x=setup({fileAssistantEnabled:false})
    await expect(x.service.analyze(1,x.request)).rejects.toThrow('Enable')
    await expect(x.service.download(1)).rejects.toThrow('Enable')
    expect(x.model.decide).not.toHaveBeenCalled(); expect(x.model.download).not.toHaveBeenCalled(); expect(x.assertLocal).not.toHaveBeenCalled()
    expect(existsSync(path.join(x.folder,'data'))).toBe(false)
  })
  it('reads content only with the independent explicit permission',async () => {
    const x=setup(); const first=await x.service.analyze(1,x.request)
    expect(first.rows[0].content).toBe('metadata'); expect(vi.mocked(x.model.decide).mock.calls[0][0].state).not.toContain('SECRET')
    x.service.configure({...options,fileAssistantReadContent:true}); const second=await x.service.analyze(1,x.request)
    expect(second.rows[0].content).toBe('text'); expect(vi.mocked(x.model.decide).mock.calls[1][0].state).toContain('SECRET')
  })
  it.each(ASSISTANT_MODES)('creates a reviewable %s proposal without mutations',async mode => {
    const x=setup(); const plan=await x.service.analyze(1,{...x.request,mode,goal:'ACME customer invoice'})
    expect(plan.mode).toBe(mode); expect(plan.rows).toHaveLength(1); expect(plan.choices.length).toBeGreaterThan(1)
    expect(x.transfer).not.toHaveBeenCalled(); expect(x.openApplication).not.toHaveBeenCalled(); expect(readFileSync(x.file,'utf8')).toContain('SECRET')
  })
  it('applies an edited destination only after confirmation and consumes the plan',async () => {
    const x=setup(); const plan=await x.service.analyze(1,x.request)
    const input={planId:plan.id,operation:'move' as const,edits:[{path:x.file,choice:plan.choices[1].id,selected:true}]}
    const result=await x.service.apply(1,input)
    expect(result.failed).toEqual([]); expect(readFileSync(path.join(x.folder,'Other','invoice.txt'),'utf8')).toContain('SECRET')
    await expect(x.service.apply(1,input)).rejects.toThrow('expired')
  })
  it('preflights all sources before any write',async () => {
    const x=setup(), other=path.join(x.folder,'other.txt');writeFileSync(other,'other')
    const plan=await x.service.analyze(1,{...x.request,paths:[x.file,other]});writeFileSync(other,'changed content')
    await expect(x.service.apply(1,{planId:plan.id,operation:'move',edits:plan.rows.map(r=>({path:r.path,choice:r.choice,selected:true}))})).rejects.toThrow('changed')
    expect(x.transfer).not.toHaveBeenCalled(); expect(existsSync(x.file)).toBe(true)
  })
  it('binds proposals to their window and permission epoch',async () => {
    const x=setup(), plan=await x.service.analyze(1,x.request), input={planId:plan.id,operation:'move' as const,edits:[{path:x.file,choice:plan.rows[0].choice,selected:true}]}
    await expect(x.service.apply(2,input)).rejects.toThrow('expired')
    x.service.configure({...options,fileAssistantEnabled:false});x.service.configure(options)
    await expect(x.service.apply(1,input)).rejects.toThrow('expired')
  })
  it('rejects symlinks and traversal category names',async () => {
    const x=setup(), link=path.join(x.folder,'link.txt');symlinkSync(x.file,link)
    await expect(x.service.analyze(1,{...x.request,paths:[link]})).rejects.toThrow('symlinks')
    await expect(x.service.analyze(1,{...x.request,categories:['../escape','Other']})).rejects.toThrow('category')
  })
  it('saves local tags, exposes them to later decisions and clears them',async () => {
    const x=setup(), plan=await x.service.analyze(1,{...x.request,mode:'tags'})
    await x.service.apply(1,{planId:plan.id,operation:'tags',edits:[{path:x.file,choice:plan.rows[0].choice,selected:true}]})
    expect(existsSync(path.join(x.folder,'data','tags.json'))).toBe(true)
    expect((await x.service.analyze(1,x.request)).rows[0].tags).toEqual(['Invoices'])
    await x.service.clearTags();expect(existsSync(path.join(x.folder,'data','tags.json'))).toBe(false)
    expect((await x.service.analyze(1,x.request)).rows[0].tags).toEqual([])
  })
  it('rejects a parallel analysis before any asynchronous filesystem work',async () => {
    const x=setup();const first=x.service.analyze(1,x.request)
    await expect(x.service.analyze(2,x.request)).rejects.toThrow('running');await first
  })
  it('does not publish an analysis completed after disabling the feature',async () => {
    const x=setup();let resolve!: (value: Awaited<ReturnType<DecisionProvider['decide']>>) => void
    vi.mocked(x.model.decide).mockImplementation(()=>new Promise(r=>{resolve=r}))
    const work=x.service.analyze(1,x.request);await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'))
    x.service.configure({...options,fileAssistantEnabled:false});resolve({choice:'c0',score:.9,probabilities:[.9,.05,.05],truncated:false,collapsed:false})
    await expect(work).rejects.toThrow();expect(x.transfer).not.toHaveBeenCalled()
  })
  it('keeps PDFs as metadata even with text permission',async () => {
    const x=setup({fileAssistantReadContent:true}),file=path.join(x.folder,'secret.pdf');writeFileSync(file,'SECRET PDF')
    const plan=await x.service.analyze(1,{...x.request,paths:[file]});expect(plan.rows[0].content).toBe('unsupported')
    expect(vi.mocked(x.model.decide).mock.calls[0][0].state).not.toContain('SECRET PDF')
  })
  it('stops subsequent mutations on cancellation and reports completed work',async () => {
    const x=setup(), second=path.join(x.folder,'second.txt');writeFileSync(second,'second')
    const original=x.transfer.getMockImplementation()!
    x.transfer.mockImplementation(async (...args) => { const result=await original(...args);x.service.cancel(1);return result })
    const plan=await x.service.analyze(1,{...x.request,paths:[x.file,second]})
    const result=await x.service.apply(1,{planId:plan.id,operation:'move',edits:plan.rows.map(r=>({path:r.path,choice:r.choice,selected:true}))})
    expect(result.completed).toHaveLength(1);expect(result.failed).toHaveLength(1);expect(result.failed[0].error).toContain('cancelled');expect(existsSync(second)).toBe(true)
  })
  it('bounds opted-in content to 16 KiB',async () => {
    const x=setup({fileAssistantReadContent:true});writeFileSync(x.file,'x'.repeat(16384)+'PRIVATE TAIL')
    await x.service.analyze(1,x.request)
    const state=vi.mocked(x.model.decide).mock.calls[0][0].state
    expect(state).toContain('x'.repeat(100));expect(state).not.toContain('PRIVATE TAIL')
  })
  it('rejects renderer-invented choices without touching files',async () => {
    const x=setup(),plan=await x.service.analyze(1,x.request)
    await expect(x.service.apply(1,{planId:plan.id,operation:'move',edits:[{path:x.file,choice:'/arbitrary/destination',selected:true}]})).rejects.toThrow('Unknown')
    expect(x.transfer).not.toHaveBeenCalled()
  })

})
