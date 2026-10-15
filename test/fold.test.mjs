import { test } from "node:test"
import assert from "node:assert/strict"
import { foldDegenerate } from "../lib/fold.mjs"

// Realistic shape captured from opencode v2's `context` hook (AI SDK messages).
function fixture() {
  return [
    { id: "u1", role: "user", content: [{ type: "text", text: "run it" }] },
    {
      id: "a1",
      role: "assistant",
      content: [
        { type: "reasoning", text: "好。".repeat(40), providerMetadata: { deepseek: {} } },
        { type: "tool-call", id: "t1", name: "shell", input: { command: "echo hi" } },
      ],
      metadata: {},
    },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", output: "hi" }] },
    { id: "a2", role: "assistant", content: [{ type: "text", text: "done" }] },
  ]
}

test("fold: only the degenerate reasoning part is removed; tool-call survives", () => {
  const input = fixture()
  const { messages, stats } = foldDegenerate(input, { dryRun: false })

  assert.equal(stats.folded, 1)
  assert.ok(stats.foldedChars > 0)

  const a1 = messages.find((m) => m.id === "a1")
  assert.deepEqual(a1.content.map((p) => p.type), ["tool-call"])
  assert.equal(a1.content[0].name, "shell")

  // Original array is not mutated.
  const originalA1 = input.find((m) => m.id === "a1")
  assert.equal(originalA1.content[0].type, "reasoning")
  assert.equal(originalA1.content.length, 2)
})

test("fold: normal reasoning is kept", () => {
  const input = [
    {
      id: "a",
      role: "assistant",
      content: [
        { type: "reasoning", text: "Let me read the file, then run the tests." },
        { type: "text", text: "ok" },
      ],
    },
  ]
  const { stats } = foldDegenerate(input, { dryRun: false })
  assert.equal(stats.folded, 0)
})

test("fold: dryRun reports but does not modify", () => {
  const input = fixture()
  const { messages, stats } = foldDegenerate(input, { dryRun: true })
  assert.equal(stats.folded, 1)
  assert.equal(messages[1].content.length, 2)
})

test("fold: blank mode keeps the part with empty text", () => {
  const input = fixture()
  const { messages } = foldDegenerate(input, { dryRun: false, foldMode: "blank" })
  const a1 = messages.find((m) => m.id === "a1")
  assert.deepEqual(a1.content.map((p) => p.type), ["reasoning", "tool-call"])
  assert.equal(a1.content[0].text, "")
})

test("fold: a message that would become empty is left alone", () => {
  const input = [
    { id: "a", role: "assistant", content: [{ type: "reasoning", text: "好。".repeat(40) }] },
  ]
  const { messages, stats } = foldDegenerate(input, { dryRun: false })
  assert.equal(stats.folded, 0)
  assert.equal(messages[0].content.length, 1)
})

test("fold: idempotent and deterministic", () => {
  const once = foldDegenerate(fixture(), { dryRun: false }).messages
  const twice = foldDegenerate(once, { dryRun: false }).messages
  assert.deepEqual(once, twice)
  assert.deepEqual(once, foldDegenerate(fixture(), { dryRun: false }).messages)
})

test("fold: unknown foldMode falls back to remove", () => {
  const { messages } = foldDegenerate(fixture(), { dryRun: false, foldMode: "nope" })
  const a1 = messages.find((m) => m.id === "a1")
  assert.deepEqual(a1.content.map((p) => p.type), ["tool-call"])
})

test("fold: reasoning on a non-assistant message is ignored", () => {
  const input = [{ role: "user", content: [{ type: "reasoning", text: "好。".repeat(40) }] }]
  const { stats } = foldDegenerate(input, { dryRun: false })
  assert.equal(stats.folded, 0)
})

test("fold: reasoning carrying a signature marker is left alone", () => {
  const input = [
    {
      id: "a",
      role: "assistant",
      content: [
        { type: "reasoning", text: "好。".repeat(40), providerMetadata: { anthropic: { signature: "abc" } } },
        { type: "tool-call", id: "t1", name: "shell", input: {} },
      ],
    },
  ]
  const { messages, stats } = foldDegenerate(input, { dryRun: false })
  assert.equal(stats.folded, 0)
  assert.equal(stats.skippedSigned, 1)
  assert.deepEqual(messages[0].content.map((p) => p.type), ["reasoning", "tool-call"])
})

test("fold: a top-level signature field also blocks folding", () => {
  const input = [
    {
      id: "a",
      role: "assistant",
      content: [
        { type: "reasoning", text: "好。".repeat(40), signature: "xyz" },
        { type: "tool-call", id: "t1", name: "shell", input: {} },
      ],
    },
  ]
  const { stats } = foldDegenerate(input, { dryRun: false })
  assert.equal(stats.folded, 0)
  assert.equal(stats.skippedSigned, 1)
})

test("fold: malformed content does not throw", () => {
  const input = [
    { role: "assistant", content: null },
    { role: "assistant" },
    { role: "assistant", content: [null, 42, { type: "reasoning" }] },
    { role: "user", content: "not-an-array" },
  ]
  assert.doesNotThrow(() => foldDegenerate(input, { dryRun: false }))
})
