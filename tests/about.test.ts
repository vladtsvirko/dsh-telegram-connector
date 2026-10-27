import { describe, expect, it } from 'vitest'
import { connectorVersion, runtimeVersion, supportedRange } from '../src/about.js'

describe('about', () => {
  it('reads the connector version from its manifest', () => {
    expect(connectorVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('declares the harness peer range', () => {
    expect(supportedRange()).toContain('>=')
  })

  it('prefers the runtime version exported by the image', () => {
    const previous = process.env.DSH_RUNTIME_VERSION
    process.env.DSH_RUNTIME_VERSION = '9.9.9-test'
    expect(runtimeVersion()).toBe('9.9.9-test')
    if (previous === undefined) delete process.env.DSH_RUNTIME_VERSION
    else process.env.DSH_RUNTIME_VERSION = previous
  })
})
