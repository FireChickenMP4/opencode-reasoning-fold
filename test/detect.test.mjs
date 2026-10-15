import { test } from "node:test"
import assert from "node:assert/strict"
import { detect, detectRepeat, detectRotation } from "../lib/detect.mjs"

test("repeat: a single unit repeated past threshold is detected", () => {
  const hit = detect("好。".repeat(40))
  assert.ok(hit)
  assert.equal(hit.via, "repeat")
  assert.equal(hit.unit, "好")
  assert.ok(hit.count >= 25)
})

test("repeat: normal prose is not flagged", () => {
  const text = "先读取配置文件，再校验字段，最后写回磁盘。整个过程要注意原子性，避免中途失败留下半成品。"
  assert.equal(detect(text), null)
})

test("rotation: english short-sentence churn is detected", () => {
  const unit = ["Let me write it.", "Go.", "Now.", "OK.", "Writing.", "Here."]
  let text = ""
  for (let i = 0; i < 40; i++) text += unit[i % unit.length] + " "
  const hit = detect(text)
  assert.ok(hit)
  assert.equal(hit.via, "rotation")
})

test("rotation: too few parts is not enough", () => {
  assert.equal(detectRotation("Let me write it. Go. Now."), null)
})

test("repeat: below the count threshold is not enough", () => {
  assert.equal(detectRepeat("好。".repeat(10)), null)
})
