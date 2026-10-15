import { test } from "node:test"
import assert from "node:assert/strict"
import { detect, detectRepeat, detectRotation } from "../lib/detect.mjs"

/** A window of Latin short sentences that rotate. */
function englishChurn() {
  const unit = ["Let me write it.", "Go.", "Now.", "OK.", "Writing.", "Here."]
  let text = ""
  for (let i = 0; i < 40; i++) text += unit[i % unit.length] + " "
  return text
}

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

test("repeat: a repeated line inside a code fence is not a loop", () => {
  const text = "Let me check the log:\n\n```\n" + "out.push(item)\n".repeat(30) + "```\n\nI will fix it next."
  assert.equal(detectRepeat(text), null)
})

test("repeat: a fence opening before the tail window is still masked", () => {
  // ~4900 chars of repeated code in one fence; the opening ``` is outside the
  // last-4000-char window, so slicing first would leave the lines exposed.
  const text = "```\n" + "out.push(item)\n".repeat(350) + "```"
  assert.equal(detectRepeat(text), null)
})

test("repeat: below the count threshold is not enough", () => {
  assert.equal(detectRepeat("好。".repeat(10)), null)
})

test("repeat: non-finite ratio thresholds fall back to defaults", () => {
  const text = "好。".repeat(40)
  const dflt = detectRepeat(text)
  assert.ok(dflt) // the fallback must still produce a hit, not null
  assert.deepEqual(detectRepeat(text, { minShare: Number.NaN }), dflt)
  assert.deepEqual(detectRepeat(text, { minShare: Number.POSITIVE_INFINITY }), dflt)
})

test("rotation: english short-sentence churn is detected", () => {
  const hit = detect(englishChurn())
  assert.ok(hit)
  assert.equal(hit.via, "rotation")
})

test("rotation: too few parts is not enough", () => {
  assert.equal(detectRotation("Let me write it. Go. Now."), null)
})

test("rotation: non-finite ratio thresholds fall back to defaults", () => {
  const text = englishChurn()
  const dflt = detectRotation(text)
  assert.ok(dflt)
  const forced = { shortShareMin: Number.NaN, topUnitShareMin: Number.POSITIVE_INFINITY }
  assert.deepEqual(detectRotation(text, forced), dflt)
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

test("rotation: short kana fragments rotate (kana counts as words)", () => {
  // Without kana in the character class these have no words, the count map is
  // empty, and the predicate returns null; with it they rotate.
  const unit = ["はい", "ええ", "うん", "そう", "まあ", "だね"]
  let text = ""
  for (let i = 0; i < 5; i++) for (const u of unit) text += u + "。"

  const hit = detectRotation(text)
  assert.ok(hit)
  assert.equal(hit.via, "rotation")
})

test("rotation: a line-structured block (labels per line) is not 'sentences rotating'", () => {
  let text = ""
  for (let i = 0; i < 30; i++) text += `Edit section ${i}:\nold:\nnew:\n`
  assert.equal(detectRotation(text), null)
})

test("rotationGuard: false disables rotation but leaves repeat working", () => {
  assert.ok(detect(englishChurn()))
  assert.equal(detect(englishChurn(), { rotationGuard: false }), null)
  assert.equal(detect("好。".repeat(40), { rotationGuard: false })?.via, "repeat")
})
