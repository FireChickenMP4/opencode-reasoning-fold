// opencode v2 plugin shell.
//
// This file is a thin adapter: it registers the `context` hook and hands the
// outgoing messages to the host-neutral core in lib/. It knows nothing about
// detection or folding semantics -- a future proxy shell can reuse the same
// core with zero changes here.
//
// The plain `export default { id, setup }` form is used (the same shape
// opencode's own local plugins use) so the package needs no build step and no
// dependency on @opencode/plugin at runtime.

import { appendFile } from "node:fs"
import { parseConfig } from "./lib/config.mjs"
import { foldDegenerate, isReasoningPart } from "./lib/fold.mjs"

const PLUGIN_ID = "reasoning-fold"

/**
 * Console + optional file logging that never throws: a logging failure must not
 * break the request it describes. A failure is reported at most once -- after
 * that there is nothing better to report through, and repeating it only adds
 * noise.
 */
function makeLog(logFile?: string) {
  let reportedFailure = false
  const reportOnce = (err: unknown): void => {
    if (reportedFailure) return
    reportedFailure = true
    try {
      console.error(`[${PLUGIN_ID}] log failure: ${err instanceof Error ? err.message : String(err)}`)
    } catch {
      /* stderr itself is unusable */
    }
  }

  return (line: string): void => {
    try {
      console.error(`[${PLUGIN_ID}] ${line}`)
    } catch {
      /* stderr is unusable; reportOnce would only reach stderr again */
    }
    if (logFile) {
      // Async on purpose: this runs on the request path, so it must not block
      // the event loop on a slow disk.
      try {
        appendFile(logFile, `${new Date().toISOString()} ${line}\n`, "utf8", (err) => {
          if (err) reportOnce(err)
        })
      } catch (e) {
        reportOnce(e)
      }
    }
  }
}

function describeHits(
  hits: Array<{ via: string; unit: string; count: number; share: number; chars: number }>,
  withUnit: boolean,
): string {
  return hits
    .map((h) => {
      const head = withUnit ? `${h.via}:${JSON.stringify(truncate(h.unit))}` : h.via
      return `${head} count=${h.count} share=${Math.round(h.share * 100)}% chars=${h.chars}`
    })
    .join(" ")
}

/** Keep log lines short; reasoning text can quote sensitive material. */
function truncate(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n)}...` : s
}

export default {
  id: PLUGIN_ID,
  async setup(ctx: any) {
    const cfg = parseConfig(ctx?.options ?? {})
    const log = makeLog(cfg.logFile)

    try {
      await ctx.session.hook("context", (event: any) => {
        try {
          if (!cfg.enabled) return
          const messages = event?.messages
          if (!Array.isArray(messages) || messages.length === 0) return

          if (cfg.debug) {
            const shape = messages
              .map((m: any) => {
                const content = Array.isArray(m?.content) ? m.content : []
                const parts = content.map((p: any) => {
                  if (isReasoningPart(p)) {
                    const pm = p?.providerMetadata
                    const keys = pm && typeof pm === "object" ? Object.keys(pm).join("+") : "-"
                    return `${p.type}(pm:${keys})`
                  }
                  return p?.type ?? "?"
                })
                return `${m?.role ?? "?"}[${parts.join(",")}]`
              })
              .join(" ")
            log(`hook session=${event?.sessionID ?? "?"} messages=${messages.length} ${shape}`)
          }

          const { messages: folded, stats } = foldDegenerate(messages, cfg)
          if (stats.folded === 0 && stats.skippedSigned === 0) return

          log(
            `session=${event?.sessionID ?? "?"} folded=${stats.folded} chars=${stats.foldedChars} ` +
              `skipped=${stats.skippedSigned} dryRun=${cfg.dryRun} mode=${cfg.foldMode}` +
              (stats.hits.length ? ` :: ${describeHits(stats.hits, cfg.debug)}` : ""),
          )
          if (stats.folded === 0 || cfg.dryRun) return

          // Replace in place: the host owns this array reference. A loop avoids
          // spreading a huge array into a call (argument-count limit).
          messages.length = 0
          for (const m of folded) messages.push(m)
        } catch (e) {
          // fail-open: never let a fold error break the request pipeline.
          log(`hook error (fail-open): ${e instanceof Error ? e.message : String(e)}`)
        }
      })
      log(`loaded (enabled=${cfg.enabled}, dryRun=${cfg.dryRun}, foldMode=${cfg.foldMode})`)
    } catch (e) {
      log(`hook registration failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
}
