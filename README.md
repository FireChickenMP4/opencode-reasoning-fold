# opencode-reasoning-guard

> OpenCode v2 plugin that detects **degenerated reasoning** (repetitive / looping
> thinking) and folds those reasoning blocks out of the outgoing context, so bad
> blocks stop being replayed every turn. Provider-agnostic (probes at runtime),
> fail-open.

> 按「思考是否退化」清理 reasoning 块；不剪工具输出、不替 OpenCode 做压缩。

## Why

When a long context starts to degenerate, the model's *reasoning* falls into a
loop (the same sentence, or the same pattern with different words, again and
again). The turn often still ends looking fine — only the thinking is rotten.

Worse, some providers send the earlier `reasoning` back on the next request, so a
bad block stays in context and is **replayed** every turn.

`opencode-reasoning-guard` watches the outgoing messages on the `context` hook,
spots the degenerate reasoning blocks in the tail, and folds them out of what is
sent to the model. It does **not** touch tool output and does **not** replace
OpenCode's own compaction.

## How it works

- Registers `ctx.session.hook("context", ...)` — runs right before model
  dispatch. Changes affect only the outgoing call, never persisted history.
- The core (`lib/`) is a pair of pure, dependency-free functions:
  - `detect(text, opts)` — is this block degenerate? (`repeat`, `rotation`)
  - `foldDegenerate(messages, opts)` — drop the degenerate `reasoning` parts.
- **The unit of folding is the part, not the message.** A degenerate `reasoning`
  part is removed while the sibling `tool-call` part stays, so
  `tool_use <-> tool_result` pairing is never broken.
- **Deterministic by design.** The hook re-reads persisted history every step and
  re-folds, producing byte-stable output (see Status for the cache question).
- **Provider-agnostic.** It probes at runtime instead of keying off a provider
  name: a message with no `reasoning` part (e.g. a non-thinking model variant)
  simply leaves the plugin idle.

## Install

Copy the repo under `.opencode/plugins/reasoning-guard/` — plugins there are
loaded automatically — or point `opencode.json(c)` at a checkout:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "./plugins/opencode-reasoning-guard", "options": { "dryRun": true } }
  ]
}
```

`"package": "opencode-reasoning-guard"` (npm) works once the package is published.

## Configuration

Options are read from `ctx.options` during setup.

| Option | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `dryRun` | **`true`** | Report what *would* be folded, change nothing. Flip to `false` to arm. |
| `foldMode` | `"remove"` | `"remove"` drops the reasoning part; `"blank"` empties its text. |
| `logFile` | – | Optional file to append decisions to (absolute path). |
| `debug` | `false` | Also log every hook call (shape summary), not just folds. |
| `tailChars` | `4000` | Only the tail window is inspected. |
| `minRepeats` | `25` | Minimum repeats of one unit. |
| `maxUnit` | `30` | Longest unit counted as "repeated". |
| `minShare` | `0.20` | Repeats must cover this share of the window's sentences. |
| `shortWordsMax` | `3` | A "short" sentence has at most this many words (rotation). |
| `shortShareMin` | `0.35` | Share of short sentences needed (rotation). |
| `topUnitShareMin` | `0.50` | Share of the top-5 units needed (rotation). |
| `minParts` | `25` | Minimum sentences in the window. |
| `rotationGuard` | `true` | Set `false` to disable the rotation heuristic entirely (only `repeat` runs). |

Every decision is written to `stderr` as counts only (no reasoning text). Set
`debug` to also log a per-hook shape line and a truncated matched snippet.

## Safety

- **Fail-open for in-process errors**: any exception while folding leaves the
  request untouched. It does *not* catch a provider that rejects an altered
  request (see the signed-thinking rule and the limitations below).
- **Signed / redacted thinking is skipped (heuristic).** A reasoning part whose
  `providerMetadata` (or its own top-level keys) is named like a signature /
  redaction marker is left alone, because those providers reject tampered
  blocks. This is a key-name heuristic, not a signature check.
- **`dryRun` defaults to on**, because the thresholds have not yet been
  calibrated on real degenerate samples. Run it in dry-run first and read the
  log; arm it when the hits look right.
- Never empties a message: if an assistant message is *only* reasoning, it is
  left alone.
- `tool-call` / `tool-result` parts are never touched.
- `logFile` should be an absolute path; a relative one is resolved against the
  process working directory.

## Status & limitations

- **Detection thresholds.** `repeat` uses the upstream defaults calibrated on a
  Chinese corpus. `rotation` is calibrated on **English** text (its short-sentence
  gate is CJK-aware: each CJK character counts as a word). Neither has been
  re-calibrated on this project's traffic.
- **The prompt cache.** Re-folding is byte-stable, but the cache effect ("fold
  only the tail, the stable prefix still hits") is **not yet measured**.
- **Scope.** Only the agent loop (`context`) is covered. The `compaction`,
  `generate`, and `title` request kinds are not, so a degenerate block can still
  be sent when those run.
- **Folding is deletion only.** The upstream project also *replaces* the step with
  a short note ("do not repeat; give the conclusion"). This plugin only removes
  the `reasoning` part and sends no hint, so whether deletion alone breaks the
  loop is **untested**.
- Providers that sign thinking blocks (Anthropic-style) are **untested**; such
  parts are automatically skipped, and `foldMode: "blank"` is there if you need
  to keep the part. An assistant message made up of *only* reasoning parts is
  never folded in either mode.
- Verified working on `deepseek/deepseek-v4-pro` and
  `ollama-cloud/deepseek-v4-pro` (reasoning parts present and safely removable).

## Development

```sh
node --test        # pure-function unit tests, no dependencies
```

Layout: `lib/` is the host-neutral core; `index.ts` is the OpenCode shell. A
future proxy (for other harnesses) would be a second shell over the same core.

Runtime: `index.ts` is loaded by OpenCode v2 (Bun); it is not a Node entry point.
The `lib/` core is dependency-free and runs on Node, which is what `node --test`
exercises.

## License

MIT. Parts of `lib/detect.mjs` are ported from another MIT project; see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
