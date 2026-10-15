// Configuration defaults and option parsing.
//
// Options come from opencode.json(c) plugins[].options and are read via
// ctx.options during setup. Unknown keys are ignored; numbers are validated so
// a bad value falls back to the default instead of breaking detection.

export const DEFAULTS = Object.freeze({
  /** Master switch. */
  enabled: true,
  /**
   * When true, the hook reports what it WOULD fold but leaves the request
   * untouched. On by default: the thresholds below are not yet calibrated on
   * real degenerate samples (see docs/PROBE-REPORT.md). Flip to false to arm.
   */
  dryRun: true,
  /**
   * How a degenerate reasoning block is folded:
   *   "remove" -- drop the reasoning part entirely (default; safest for
   *               providers that sign thinking blocks).
   *   "blank"  -- keep the part, empty its text.
   */
  foldMode: "remove",
  /** Optional diagnostics file; when set, decisions are appended there. */
  logFile: undefined,
  /** Log every hook call (shape summary), not just folds. */
  debug: false,
  /** Detection thresholds (upstream defaults). */
  tailChars: 4000,
  minRepeats: 25,
  maxUnit: 30,
  minShare: 0.2,
  shortWordsMax: 3,
  shortShareMin: 0.35,
  topUnitShareMin: 0.5,
  minParts: 25,
})

const INT_FIELDS = ["tailChars", "minRepeats", "maxUnit", "shortWordsMax", "minParts"]
const RATIO_FIELDS = ["minShare", "shortShareMin", "topUnitShareMin"]

/**
 * Merge user options over the defaults.
 * @param {unknown} options
 * @returns {typeof DEFAULTS & { logFile?: string }}
 */
export function parseConfig(options = {}) {
  const o = options && typeof options === "object" ? options : {}
  const cfg = { ...DEFAULTS }
  if (typeof o.enabled === "boolean") cfg.enabled = o.enabled
  if (typeof o.dryRun === "boolean") cfg.dryRun = o.dryRun
  if (o.foldMode === "remove" || o.foldMode === "blank") cfg.foldMode = o.foldMode
  if (typeof o.logFile === "string" && o.logFile.length > 0) cfg.logFile = o.logFile
  if (typeof o.debug === "boolean") cfg.debug = o.debug
  // Integer thresholds: reject floats/strings so a value the detector would
  // ignore is not silently accepted as "tuned".
  for (const k of INT_FIELDS) if (Number.isSafeInteger(o[k])) cfg[k] = o[k]
  // Ratio thresholds (0..1-ish): any finite non-negative number.
  for (const k of RATIO_FIELDS) if (typeof o[k] === "number" && Number.isFinite(o[k]) && o[k] >= 0) cfg[k] = o[k]
  return cfg
}
