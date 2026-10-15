// Pure fold: drop degenerated reasoning parts from an outgoing message array.
//
// Contract: input/output are the host-neutral, AI SDK style messages that
// opencode's `context` hook exposes (and that a future proxy shell can also
// produce):  { role, content: Array<{ type, ... }> }
//
// The unit of folding is the PART, not the message. A degenerate `reasoning`
// part is removed (or blanked) while the sibling `tool-call` part is left
// untouched -- so tool_use <-> tool_result pairing is never broken.
//
// The function is pure and deterministic: given the same messages it returns
// the same bytes, so re-folding on every step (the hook re-reads persisted
// history each step) does not make the prompt cache flap.

import { detect } from "./detect.mjs"

const REASONING_TYPES = new Set(["reasoning", "thinking"])

/**
 * True for a `reasoning` / `thinking` part.
 * @param {any} part
 * @returns {boolean}
 */
export function isReasoningPart(part) {
  return Boolean(part) && typeof part === "object" && REASONING_TYPES.has(part.type)
}

/**
 * Providers that sign or redact thinking blocks reject tampered ones, so a
 * reasoning part whose providerMetadata carries a signature/redaction marker is
 * never folded. The scan is nested (providerMetadata is provider-keyed).
 */
const SIGNED_KEY = /(signature|redacted|encrypted)/i

function looksSigned(pm) {
  if (!pm || typeof pm !== "object") return false
  const stack = [pm]
  const seen = new Set()
  while (stack.length) {
    const cur = stack.pop()
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue
    seen.add(cur)
    for (const [k, v] of Object.entries(cur)) {
      if (SIGNED_KEY.test(k)) return true
      if (v && typeof v === "object") stack.push(v)
    }
  }
  return false
}

/** Part keys that are never signature carriers (so they are not misread). */
const SAFE_PART_KEYS = new Set(["type", "text", "state", "time", "providerMetadata"])

function partLooksSigned(part) {
  if (looksSigned(part.providerMetadata)) return true
  for (const k of Object.keys(part)) {
    if (!SAFE_PART_KEYS.has(k) && SIGNED_KEY.test(k)) return true
  }
  return false
}

/**
 * One degenerated-reasoning hit, as reported in the fold stats.
 * @typedef {object} FoldHit
 * @property {string} via
 * @property {string} unit
 * @property {number} count
 * @property {number} share
 * @property {number} chars
 * @property {string} [messageID]  id of the message carrying the part, for later lookup
 */

/**
 * @typedef {object} FoldStats
 * @property {number} folded
 * @property {number} foldedChars
 * @property {number} skippedSigned
 * @property {FoldHit[]} hits
 */

/**
 * @param {Array<any>} messages
 * @param {object} [opts] detection thresholds + { dryRun, foldMode }
 * @returns {{ messages: Array<any>, stats: FoldStats }}
 */
export function foldDegenerate(messages, opts = {}) {
  const o = opts ?? {}
  const dryRun = o.dryRun === true
  const foldMode = o.foldMode === "blank" ? "blank" : "remove"
  /** @type {FoldStats} */
  const stats = { folded: 0, foldedChars: 0, skippedSigned: 0, hits: [] }

  if (!Array.isArray(messages)) return { messages, stats }

  const out = messages.map((m) => {
    if (!m || m.role !== "assistant" || !Array.isArray(m.content)) return m

    // Detect first, then check the signature, so `skippedSigned` means
    // "degenerate but signed -> skipped" rather than "any signed part".
    const hits = []
    for (const part of m.content) {
      if (isReasoningPart(part) && typeof part.text === "string" && part.text.length > 0) {
        const hit = detect(part.text, o)
        if (hit) {
          hits.push({
            part,
            hit,
            signed: partLooksSigned(part),
            messageID: typeof m.id === "string" ? m.id : undefined,
          })
        }
      }
    }
    if (hits.length === 0) return m

    const foldable = hits.filter((h) => !h.signed)
    // Never fold a message down to nothing (remove) or to a lone empty part
    // (blank); leave it untouched instead.
    if (foldable.length > 0 && foldable.length === m.content.length) return m

    for (const h of hits) {
      if (h.signed) {
        stats.skippedSigned += 1
        continue
      }
      stats.folded += 1
      stats.foldedChars += h.part.text.length
      stats.hits.push({
        via: h.hit.via,
        unit: h.hit.unit,
        count: h.hit.count,
        share: h.hit.share,
        chars: h.part.text.length,
        messageID: h.messageID,
      })
    }

    if (foldable.length === 0 || dryRun) return m

    const nextContent = []
    for (const part of m.content) {
      const h = hits.find((x) => x.part === part)
      if (!h || h.signed) nextContent.push(part)
      else if (foldMode === "blank") nextContent.push({ ...part, text: "" })
      // foldMode === "remove": drop the part.
    }
    return { ...m, content: nextContent }
  })

  return { messages: out, stats }
}
