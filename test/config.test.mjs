import { test } from "node:test"
import assert from "node:assert/strict"
import { parseConfig, DEFAULTS } from "../lib/config.mjs"

test("defaults: dryRun is on, remove mode", () => {
  const c = parseConfig()
  assert.equal(c.dryRun, true)
  assert.equal(c.foldMode, "remove")
  assert.equal(c.minRepeats, DEFAULTS.minRepeats)
})

test("overrides are applied", () => {
  const c = parseConfig({ dryRun: false, foldMode: "blank", minRepeats: 3, debug: true })
  assert.equal(c.dryRun, false)
  assert.equal(c.foldMode, "blank")
  assert.equal(c.minRepeats, 3)
  assert.equal(c.debug, true)
})

test("invalid values fall back to defaults", () => {
  const c = parseConfig({ minRepeats: "nope", foldMode: "wat", enabled: 0 })
  assert.equal(c.minRepeats, DEFAULTS.minRepeats)
  assert.equal(c.foldMode, "remove")
  assert.equal(c.enabled, true) // 0 is not a boolean -> ignored
})

test("a boolean enabled is honoured", () => {
  assert.equal(parseConfig({ enabled: false }).enabled, false)
})

test("non-object options are ignored", () => {
  assert.equal(parseConfig(null).dryRun, true)
  assert.equal(parseConfig(undefined).dryRun, true)
})
