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

function isReasoning(part) {
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
 * @param {Array<any>} messages
 * @param {object} [opts] detection thresholds + { dryRun, foldMode }
 * @returns {{ messages: Array<any>, stats: { folded: number, foldedChars: number, skippedSigned: number, hits: Array<object> } }}
 */
export function foldDegenerate(messages, opts = {}) {
  const dryRun = opts.dryRun === true
  const foldMode = opts.foldMode === "blank" ? "blank" : "remove"
  const stats = { folded: 0, foldedChars: 0, skippedSigned: 0, hits: [] }

  if (!Array.isArray(messages)) return { messages, stats }

  const out = messages.map((m) => {
    if (!m || m.role !== "assistant" || !Array.isArray(m.content)) return m

    // A message with nothing but reasoning must not be emptied out.
    const hasNonReasoning = m.content.some((p) => !isReasoning(p))
    if (!hasNonReasoning) return m

    let changed = false
    const nextContent = []
    for (const part of m.content) {
      if (isReasoning(part) && typeof part.text === "string" && part.text.length > 0) {
        if (partLooksSigned(part)) {
          stats.skippedSigned += 1
          nextContent.push(part)
          continue
        }
        const hit = detect(part.text, opts)
        if (hit) {
          changed = true
          stats.folded += 1
          stats.foldedChars += part.text.length
          stats.hits.push({
            via: hit.via,
            unit: hit.unit,
            count: hit.count,
            share: hit.share,
            chars: part.text.length,
          })
          if (dryRun) {
            nextContent.push(part)
          } else if (foldMode === "blank") {
            nextContent.push({ ...part, text: "" })
          }
          // foldMode === "remove": push nothing.
          continue
        }
      }
      nextContent.push(part)
    }
    // In dryRun nothing is actually changed, so return the original object.
    return changed && !dryRun ? { ...m, content: nextContent } : m
  })

  return { messages: out, stats }
}
