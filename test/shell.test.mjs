import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
    { id: "u1", role: "user", content: [{ type: "text", text: "run it" }] },
    {
      id: "a1",
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

test("shell: with logFile set, a fold appends a line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reasoning-fold-"))
  try {
    const logFile = join(dir, "log.txt")
    const ctx = await setup({ dryRun: false, logFile })
    await quiet(() => ctx.hooks.context({ sessionID: "s", messages: degenerateMessages() }))
    await new Promise((resolve) => setTimeout(resolve, 100)) // appendFile is async
    const written = readFileSync(logFile, "utf8")
    assert.match(written, /folded=1/)
    assert.match(written, /msg=a1/) // the folded message's id, for a later lookup
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("shell: debug logs a shape line even with nothing degenerate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reasoning-fold-"))
  try {
    const logFile = join(dir, "log.txt")
    const ctx = await setup({ dryRun: true, debug: true, logFile })
    await quiet(() =>
      ctx.hooks.context({ sessionID: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.match(readFileSync(logFile, "utf8"), /hook session=s/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("shell: every request is traced when logFile is set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reasoning-fold-"))
  try {
    const logFile = join(dir, "log.txt")
    const ctx = await setup({ dryRun: false, logFile })
    await quiet(() =>
      ctx.hooks.context({ sessionID: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    )
    await quiet(() => ctx.hooks.context({ sessionID: "s", messages: degenerateMessages() }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    const written = readFileSync(logFile, "utf8")
    assert.match(written, /checked session=s msgs=1 reasoning=0 hits=0/)
    assert.match(written, /checked session=s msgs=2 reasoning=1 hits=1/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("shell: a failing logFile is reported at most once", async () => {
  const orig = console.error
  const logged = []
  try {
    // A NUL byte makes appendFile throw synchronously, so this needs no timers:
    // the assertion is deterministic.
    const ctx = fakeCtx({ dryRun: false, logFile: "bad\u0000path" })
    console.error = (...args) => {
      logged.push(args.join(" "))
    }
    await plugin.setup(ctx)
    for (let i = 0; i < 3; i++) ctx.hooks.context({ sessionID: "s", messages: degenerateMessages() })
  } finally {
    console.error = orig
  }
  assert.equal(logged.filter((line) => line.includes("log failure")).length, 1)
})
