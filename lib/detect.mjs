// Pure detection heuristics for "degenerated reasoning" (loop / repetition).
//
// Ported from walksls/dsh-degeneration-kit (MIT), thinking-guard/lib:
//   - detect()      -> "same unit repeated" (repeat)
//   - rotationHit() -> "many short sentences rotating" (rotation)
//
// Only the pure predicates are ported; the DSH host integration is not.
// Thresholds are the upstream defaults, calibrated on a Chinese corpus and
// NOT yet re-calibrated here.

/** Sentence split (shared with upstream, so off-line and on-line agree). */
const SPLIT = /[。！？!?\n]+|\.\s+/
/** A repeated unit must contain at least one real character (letter/digit/CJK). */
const MEANINGFUL = /[A-Za-z0-9\u4e00-\u9fff]/
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

  const tail = text.length > Math.max(1, tailChars) ? text.slice(-Math.max(1, tailChars)) : text
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

/** Normalised word count (lowercase, digits -> #, keep a-z and spaces only). */
function wordCount(s) {
  return s.toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#\s]/g, " ").trim().split(/\s+/).filter(Boolean).length
}

/**
 * Whether the tail is "many short sentences rotating" (English-style decay).
 * @param {string} text
 * @param {object} [cfg]
 * @returns {null | {via:"rotation", unit:string, count:number, share:number, shortShare:number, parts:number, top:Array}}
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
 * @param {string} text
 * @param {object} [cfg]
 * @returns {ReturnType<typeof detectRepeat> | ReturnType<typeof detectRotation>}
 */
export function detect(text, cfg = {}) {
  return detectRepeat(text, cfg) ?? detectRotation(text, cfg)
}
