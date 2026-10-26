import { describe, expect, it } from 'vitest'
import { createLoadGate } from './loadGate'

describe('load gate', () => {
  it('keeps only the last navigation when answers arrive out of order', () => {
    const gate = createLoadGate()
    const toA = gate.navigation()
    const toB = gate.navigation()
    // B answers first, A's slow answer arrives afterwards and must not take the tab back.
    expect(toB()).toBe(true)
    expect(toA()).toBe(false)
  })

  it('drops a refresh overtaken by a navigation, but a refresh never cancels a navigation', () => {
    const gate = createLoadGate()
    const refresh = gate.refresh()
    const nav = gate.navigation()
    expect(refresh()).toBe(false)
    expect(nav()).toBe(true)

    const nav2 = gate.navigation()
    const refresh2 = gate.refresh()
    expect(nav2()).toBe(true)
    expect(refresh2()).toBe(true)
  })

  it('keeps only the newest of overlapping refreshes', () => {
    const gate = createLoadGate()
    const first = gate.refresh()
    const second = gate.refresh()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })
})
