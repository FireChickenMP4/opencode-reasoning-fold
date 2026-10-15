# Third-party notices

This project is MIT licensed (see `LICENSE`). It includes code ported from
another MIT-licensed project, whose notice is retained below.

## walksls/dsh-degeneration-kit

The detection predicates in `lib/detect.mjs` (the `repeat` and `rotation`
heuristics, including the sentence split, meaningful-character test, and word
count) are ported from walksls/dsh-degeneration-kit.

The plugin's overall idea -- folding a degenerated reasoning block out of the
model-visible history so it is not replayed every turn -- and the README "Why"
section come from the same project's `thinking-guard`.

    Copyright (c) 2026 walksls

    Licensed under the MIT License.

Source: https://github.com/walksls/dsh-degeneration-kit
