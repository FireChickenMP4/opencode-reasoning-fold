import { test } from "node:test"
import assert from "node:assert/strict"
import plugin from "../index.ts"

function fakeCtx(options = {}) {
  const hooks = {}
  return {
    options,
    session: {
      hook(name, fn) {
        hooks[name] = fn
        return { dispose() {} }
      },
    },
    hooks,
  }
}

function degenerateMessages() {
  return [
    { role: "user", content: [{ type: "text", text: "run it" }] },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "好。".repeat(40) },
        { type: "tool-call", id: "t1", name: "shell", input: {} },
      ],
    },
  ]
}

/** The shell logs through console.error; keep test output clean. */
async function quiet(fn) {
  const orig = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = orig
  }
}

async function setup(options) {
  const ctx = fakeCtx(options)
  await quiet(() => plugin.setup(ctx))
  return ctx
}

test("shell: setup registers a context hook", async () => {
  const ctx = await setup()
  assert.equal(typeof ctx.hooks.context, "function")
})

test("shell: dryRun (default) leaves the messages unchanged", async () => {
  const ctx = await setup()
  const messages = degenerateMessages()
  const before = JSON.stringify(messages)
  await quiet(() => ctx.hooks.context({ sessionID: "s", messages }))
  assert.equal(JSON.stringify(messages), before)
})

test("shell: armed folds the degenerate reasoning part in place", async () => {
  const ctx = await setup({ dryRun: false })
  const messages = degenerateMessages()
  await quiet(() => ctx.hooks.context({ sessionID: "s", messages }))
  const assistant = messages.find((m) => m.role === "assistant")
  assert.deepEqual(assistant.content.map((p) => p.type), ["tool-call"])
})

test("shell: nothing degenerate -> messages are left as-is", async () => {
  const ctx = await setup({ dryRun: false })
  const messages = [
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "Let me read the file first." },
        { type: "text", text: "ok" },
      ],
    },
  ]
  const ref = messages[0]
  ctx.hooks.context({ sessionID: "s", messages })
  assert.equal(messages[0], ref)
})

test("shell: fail-open when the event accessor throws", async () => {
  const ctx = await setup({ dryRun: false })
  const event = {
    sessionID: "s",
    get messages() {
      throw new Error("boom")
    },
  }
  await quiet(() => assert.doesNotThrow(() => ctx.hooks.context(event)))
})

test("shell: disabled -> no change", async () => {
  const ctx = await setup({ enabled: false, dryRun: false })
  const messages = degenerateMessages()
  const before = JSON.stringify(messages)
  ctx.hooks.context({ sessionID: "s", messages })
  assert.equal(JSON.stringify(messages), before)
})
