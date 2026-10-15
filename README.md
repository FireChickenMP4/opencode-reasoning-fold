# opencode-reasoning-fold

**English** | [Chinese](README.zh.md)

> OpenCode v2 plugin that detects **degenerated reasoning** (repetitive / looping
> thinking) and folds those reasoning blocks out of the outgoing context, so bad
> blocks stop being replayed every turn. Provider-agnostic, fail-open.

## Why

When a long context starts to degenerate, the model's *reasoning* falls into a
loop (the same sentence, or the same pattern with different words, again and
again). The turn often still looks fine — only the reasoning is broken.

Worse, some providers send the earlier `reasoning` back on the next request, so a
bad block stays in context and is **replayed** every turn.

`opencode-reasoning-fold` watches the outgoing messages on the `context` hook,
spots the degenerate reasoning blocks in the tail, and folds them out of what is
sent to the model. It does not touch tool output and does not replace OpenCode's
own compaction.

## How it works

- Registers `ctx.session.hook("context", ...)` — runs right before model
  dispatch. Changes apply to the outgoing call only; persisted history is not
  modified.
- The core (`lib/`) is a small, pure, dependency-free set of functions:
  - `detect(text, opts)` — is this block degenerate? (`repeat`, `rotation`)
  - `foldDegenerate(messages, opts)` — drop the degenerate `reasoning` parts.
- **The unit of folding is the part, not the message.** A degenerate `reasoning`
  part is removed while the sibling `tool-call` part stays, so the
  `tool-call <-> tool-result` pairing stays intact.
- Only reasoning **detected as degenerate** is removed; normal historical
  reasoning is kept.
- **Deterministic by design.** The hook re-reads persisted history every step and
  re-folds, producing byte-stable output (see Status for the cache question).
- **Provider-agnostic.** It keys off the message shape, not a provider name: a
  message with no `reasoning` part (e.g. a non-thinking model variant) leaves the
  plugin idle.

## Install

Copy the repo under `.opencode/plugins/reasoning-fold/` — plugins there are
loaded automatically — or add a checkout path to `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "/path/to/opencode-reasoning-fold", "options": { "dryRun": true } }
  ]
}
```

`"package": "opencode-reasoning-fold"` (npm) works once the package is published.

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
| `minRepeats` | `25` | Minimum repeats of one unit; also the minimum sentence count for the `repeat` heuristic. |
| `maxUnit` | `30` | Longest unit counted as "repeated". |
| `minShare` | `0.20` | Repeats must cover this share of the window's sentences. |
| `shortWordsMax` | `3` | A "short" sentence has at most this many words (rotation); a CJK character counts as a word, so for Chinese this is about 3 characters. |
| `shortShareMin` | `0.35` | Share of short sentences needed (rotation). |
| `topUnitShareMin` | `0.50` | Share of the top-5 units needed (rotation). |
| `minParts` | `25` | Minimum sentences in the window. |
| `rotationGuard` | `true` | Set `false` to disable the rotation heuristic entirely (only `repeat` runs). |

A fold or a signed-skip is written to `stderr` as counts only (no reasoning
text); a run with no folds and no signed skips logs nothing. Set `debug` to also
log a per-hook shape line and a truncated matched snippet.

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
- An assistant message that is *only* reasoning is left alone.
- `tool-call` / `tool-result` parts are not folded.
- `logFile` should be an absolute path; a relative one is resolved against the
  process working directory.

## Status & limitations

- **Detection thresholds.** `repeat` uses the upstream defaults calibrated on a
  Chinese corpus. `rotation` is calibrated on **English** text (its short-sentence
  gate counts CJK-script characters — han, kana, hangul — as words), and is skipped
  when the tail window is newline-dominant (lists, tables, indented code), so a loop
  laid out one phrase per line is not detected by it. Neither heuristic has been
  re-calibrated on this project's traffic.
- **The prompt cache.** Re-folding is byte-stable, but whether the unchanged
  prefix still hits the cache is **not yet measured**.
- **Scope.** Only the agent loop (`context`) is covered. The `compaction`,
  `generate`, and `title` request kinds are not, so a degenerate block can still
  be sent when those run.
- **No replacement hint.** The upstream project *replaces* the folded step with a
  short note ("do not repeat; give the conclusion"). This plugin drops (or, in
  `foldMode: "blank"`, empties) the `reasoning` part and sends no hint, so whether
  that alone breaks the loop is **untested**.
- Providers that sign thinking blocks (Anthropic-style) are **untested**; such
  parts are skipped in every mode. `foldMode: "blank"` keeps a non-signed
  reasoning part while emptying its text.
- Verified on `deepseek/deepseek-v4-pro` and `ollama-cloud/deepseek-v4-pro`
  (reasoning parts present; folding completes without error).

## Development

```sh
node --test        # pure-function unit tests, no dependencies
```

Layout: `lib/` is the host-neutral core; `index.ts` is the OpenCode shell. A
future proxy (for other harnesses) would be a second shell over the same core.

Runtime: `index.ts` is loaded by OpenCode v2 (Bun); it is not a Node entry point,
which is why the package's root export points at `index.ts`. The `lib/` core is
dependency-free and runs on Node — that is what `node --test` exercises, together
with `index.ts` itself via Node's TypeScript stripping.

## License

MIT. Parts of `lib/detect.mjs` are ported from another MIT project; see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
