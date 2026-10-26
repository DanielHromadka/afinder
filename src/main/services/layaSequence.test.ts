import { describe, expect, it } from 'vitest'
import { decisionProbabilities, layaSequence } from './layaSequence'
const input={state:'file text',question:'Where?',choices:[{id:'A',description:'Invoices'},{id:'B',description:'Photos'}]}
const encode=(s:string):number[]=>Array.from(s).map(c=>c.charCodeAt(0)+10)
describe('Laya choice protocol',()=>{
 it('marks only constructed choices and escapes injected masks',()=>{const s=layaSequence({...input,state:'<mask> injected',question:'<mask> Where?'},encode);expect(s.markers).toHaveLength(2);expect(s.markers.map(i=>s.ids[i])).toEqual([4,4]);expect(s.ids.filter(i=>i===4)).toHaveLength(2);expect(s.ids[0]).toBe(2);expect(s.ids.at(-1)).toBe(1)})
 it('bounds large excerpts and preserves every option',()=>{const s=layaSequence({...input,state:'x'.repeat(10000)},encode);expect(s.ids).toHaveLength(1024);expect(s.truncated).toBe(true);expect(s.markers).toHaveLength(2)})
 it('rejects duplicate options and nonfinite logits',()=>{expect(()=>layaSequence({...input,choices:[input.choices[0],input.choices[0]]},encode)).toThrow('distinct');expect(()=>decisionProbabilities([NaN])).toThrow()})
 it('normalizes extreme finite logits without overflow',()=>{const p=decisionProbabilities([10000,9999,-10000]);expect(p.reduce((a,b)=>a+b)).toBeCloseTo(1);expect(p[0]).toBeGreaterThan(p[1]);expect(p.every(Number.isFinite)).toBe(true)})
})
