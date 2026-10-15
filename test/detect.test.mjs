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

test("detect: non-finite ratio thresholds fall back to defaults", () => {
  const text = "好。".repeat(40)
  assert.deepEqual(detectRepeat(text, { minShare: Number.NaN }), detectRepeat(text))
  assert.deepEqual(detectRepeat(text, { minShare: Number.POSITIVE_INFINITY }), detectRepeat(text))
})

test("rotation: non-finite ratio thresholds fall back to defaults", () => {
  const unit = ["Let me write it.", "Go.", "Now.", "OK.", "Writing.", "Here."]
  let text = ""
  for (let i = 0; i < 40; i++) text += unit[i % unit.length] + " "
  const forced = { shortShareMin: Number.NaN, topUnitShareMin: Number.POSITIVE_INFINITY }
  assert.deepEqual(detectRotation(text, forced), detectRotation(text))
})

test("rotation: CJK-aware word count kills the normal-Chinese false positive", () => {
  // 8 Chinese sentences x4; two are 3 chars (counted "short"), so shortShare = 8/32 = 0.25 < 0.35.
  const unit = ["先看配置文件", "再跑测试", "然后提交", "检查日志", "写文档", "改代码", "想想边界", "确认行为"]
  let text = ""
  for (let i = 0; i < 4; i++) for (const u of unit) text += u + "。"

  assert.equal(detectRotation(text), null)
  assert.equal(detect(text), null)
})

test("rotation: genuinely short CJK fragments still rotate", () => {
  // 1-2 char fragments, as in real Chinese degeneration.
  const unit = ["好", "对", "行", "嗯", "可以", "继续"]
  let text = ""
  for (let i = 0; i < 5; i++) for (const u of unit) text += u + "。"

  const hit = detectRotation(text)
  assert.ok(hit)
  assert.equal(hit.via, "rotation")
  assert.equal(detect(text)?.via, "rotation")
})

test("rotationGuard: false disables rotation but leaves repeat working", () => {
  const unit = ["Let me write it.", "Go.", "Now.", "OK.", "Writing.", "Here."]
  let text = ""
  for (let i = 0; i < 40; i++) text += unit[i % unit.length] + " "
  assert.ok(detect(text))
  assert.equal(detect(text, { rotationGuard: false }), null)
  assert.equal(detect("好。".repeat(40), { rotationGuard: false })?.via, "repeat")
})
