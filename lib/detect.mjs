// Pure detection heuristics for "degenerated reasoning" (loop / repetition).
//
// Ported from walksls/dsh-degeneration-kit (MIT), thinking-guard/lib:
//   - detect()      -> "same unit repeated" (repeat)
//   - rotationHit() -> "many short sentences rotating" (rotation)
//
// Only the pure predicates are ported; the DSH host integration is not.
// Thresholds are the upstream defaults (repeat calibrated on a Chinese corpus,
// rotation on English); they are NOT yet re-calibrated here.

/** Sentence split (shared with upstream, so off-line and on-line agree). */
const SPLIT = /[。！？!?\n]+|\.\s+/
/** A repeated unit must contain at least one real character (letter/digit/CJK-script). */
const MEANINGFUL = /[0-9A-Za-z\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/
const CODE_FENCE = /```[\s\S]*?```/g

/**
 * Whether a string looks like a repeated unit.
 * @param {string} text
 * @param {object} [cfg]
 * @returns {null | {via:"repeat", unit:string, count:number, share:number, parts:number}}
 */
export function detectRepeat(text, cfg = {}) {
  if (typeof text !== "string" || text.length === 0) return null
  const minRepeats = Number.isSafeInteger(cfg.minRepeats) ? cfg.minRepeats : 25
  const maxUnit = Number.isSafeInteger(cfg.maxUnit) ? cfg.maxUnit : 30
  const tailChars = Number.isSafeInteger(cfg.tailChars) ? cfg.tailChars : 4000
  const minShare = Number.isFinite(cfg.minShare) && cfg.minShare >= 0 ? cfg.minShare : 0.2

  const tail = (text.length > Math.max(1, tailChars) ? text.slice(-Math.max(1, tailChars)) : text).replace(CODE_FENCE, " ")
  const parts = tail.split(SPLIT).map((s) => s.trim()).filter((s) => s.length > 0)
  if (parts.length < minRepeats) return null

  const counts = new Map()
  let best = ""
  let bestN = 0
  for (const p of parts) {
    if (p.length > maxUnit) continue
    if (!MEANINGFUL.test(p)) continue
    const n = (counts.get(p) ?? 0) + 1
    counts.set(p, n)
    if (n > bestN) {
      bestN = n
      best = p
    }
  }
  if (bestN < minRepeats) return null
  // Denominator = every sentence in the window (see upstream rationale).
  const share = bestN / parts.length
  if (share < minShare) return null
  return { via: "repeat", unit: best, count: bestN, share, parts: parts.length }
}

/** CJK-script characters: ideographs (incl. ext A and compatibility), kana, hangul. */
const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/

/**
 * Normalised word count: Latin words count one each (lowercase, digits -> #),
 * and each CJK-script character counts as one word.
 *
 * The CJK part matters: without it every Chinese/Japanese/Korean sentence counts
 * as zero words and is trivially "short", which makes the rotation heuristic's
 * short-sentence gate meaningless there. Counting these characters restores it.
 */
function wordCount(s) {
  const latin = s.toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#\s]/g, " ").trim().split(/\s+/).filter(Boolean).length
  let cjk = 0
  for (const ch of s) if (CJK_CHAR.test(ch)) cjk += 1
  return latin + cjk
}

/**
 * Whether the tail is "many short sentences rotating".
 * @param {string} text
 * @param {object} [cfg]
 * @returns {null | {via:"rotation", unit:string, count:number, share:number, shortShare:number, parts:number, top:Array}}
 *   Note `count` is the single top unit's count while `share` is the top-5 units'
 *   combined share, so the two are not directly comparable.
 */
export function detectRotation(text, cfg = {}) {
  if (typeof text !== "string" || text.length === 0) return null
  const tailChars = Number.isSafeInteger(cfg.tailChars) ? cfg.tailChars : 4000
  const shortWordsMax = Number.isSafeInteger(cfg.shortWordsMax) ? cfg.shortWordsMax : 3
  const shortShareMin = Number.isFinite(cfg.shortShareMin) && cfg.shortShareMin >= 0 ? cfg.shortShareMin : 0.35
  const topUnitShareMin = Number.isFinite(cfg.topUnitShareMin) && cfg.topUnitShareMin >= 0 ? cfg.topUnitShareMin : 0.5
  const minParts = Number.isSafeInteger(cfg.minParts) ? cfg.minParts : 25

  const window = Math.max(1, tailChars)
  const tail = (text.length > window ? text.slice(-window) : text).replace(CODE_FENCE, " ")
  const parts = tail.split(SPLIT).map((s) => s.trim()).filter(Boolean)
  if (parts.length < minParts) return null

  let short = 0
  const counts = new Map()
  for (const p of parts) {
    if (wordCount(p) <= shortWordsMax) short += 1
    if (MEANINGFUL.test(p)) counts.set(p, (counts.get(p) || 0) + 1)
  }
  if (counts.size === 0) return null

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const shortShare = short / parts.length
  const topUnitShare = top.reduce((sum, [, n]) => sum + n, 0) / parts.length
  if (shortShare < shortShareMin || topUnitShare < topUnitShareMin) return null

  return {
    via: "rotation",
    unit: top[0][0],
    count: top[0][1],
    share: topUnitShare,
    shortShare,
    parts: parts.length,
    top,
  }
}

/**
 * Combined predicate: repeat first, then rotation.
 *
 * `rotation` is skipped entirely when `rotationGuard` is false. The rotation
 * heuristic's short-sentence gate is CJK-aware via `wordCount`.
 *
 * @param {string} text
 * @param {object} [cfg]
 * @returns {ReturnType<typeof detectRepeat> | ReturnType<typeof detectRotation>}
 */
export function detect(text, cfg = {}) {
  const repeat = detectRepeat(text, cfg)
  if (repeat) return repeat
  if (cfg.rotationGuard === false) return null
  return detectRotation(text, cfg)
}
