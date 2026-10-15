# opencode-reasoning-fold

[English](README.md) | **中文**

> 一个 OpenCode v2 插件：检测**退化的思考**（复读 / 打转），把这些 reasoning 块从出站上下文里折叠掉，让坏块不再每轮被重放。provider 无关，出错放行（fail-open）。

## 为什么

长上下文开始退化时，模型的 *reasoning* 会陷入循环（同一句、或同一模式换着词反复）。回合表面往往仍正常结束 —— 烂的只是思考。

更糟的是，有些 provider 会在下一次请求里把先前的 `reasoning` 回传，于是坏块留在上下文里、**每轮被重放**。

`opencode-reasoning-fold` 在 `context` hook 上观察出站消息，识别尾部退化的 reasoning 块，并把它们从发给模型的内容里折叠掉。它不碰工具输出，也不替代 OpenCode 自带的压缩。

## 工作原理

- 注册 `ctx.session.hook("context", ...)` —— 在模型派发前运行。改动只作用于出站调用；不修改持久化历史。
- 内核（`lib/`）是一小组纯函数、零依赖：
  - `detect(text, opts)` —— 这个块是否退化？（`repeat`、`rotation`）
  - `foldDegenerate(messages, opts)` —— 去掉退化的 `reasoning` part。
- **折叠的单位是 part，不是整条消息。** 去掉退化的 `reasoning` part，同时保留同一条消息里的 `tool-call` part，因此 `tool-call <-> tool-result` 配对保持完整。
- 只去掉**被判为退化**的 reasoning；正常的历史思考会保留。
- **确定性。** hook 每一步都重新读取持久化历史并重新折叠，输出字节稳定（缓存问题见「状态」）。
- **Provider 无关。** 它按消息形状判断，而非 provider 名：一条没有 `reasoning` part 的消息（例如非思考变体模型）会让插件空转。

## 安装

把仓库放到 `.opencode/plugins/reasoning-fold/` 下 —— 该目录下的插件会自动加载 —— 或在 `opencode.json(c)` 里指向一个 checkout 路径：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "/path/to/opencode-reasoning-fold", "options": { "dryRun": true } }
  ]
}
```

`"package": "opencode-reasoning-fold"`（npm）在包发布后可用。

## 配置

选项在 setup 时从 `ctx.options` 读取。

| 选项 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关。 |
| `dryRun` | **`true`** | 只报告*将会*折叠什么，不改动。改 `false` 才真正启用。 |
| `foldMode` | `"remove"` | `"remove"` 去掉 reasoning part；`"blank"` 保留 part 但清空其文本。 |
| `logFile` | – | 可选：把决策追加写入的文件（绝对路径）。 |
| `debug` | `false` | 额外记录每次 hook 调用（形状摘要），不只记录命中。 |
| `tailChars` | `4000` | 只检查尾部窗口。 |
| `minRepeats` | `25` | 一个单元的最小重复次数；同时是 `repeat` 判据的窗口最小句数。 |
| `maxUnit` | `30` | 视为「重复单元」的最大长度。 |
| `minShare` | `0.20` | 重复次数需覆盖窗口句数的比例。 |
| `shortWordsMax` | `3` | 「短句」的词数上限（rotation）；CJK 字符按一个词计，所以中文约等于 3 个字。 |
| `shortShareMin` | `0.35` | 短句占比下限（rotation）。 |
| `topUnitShareMin` | `0.50` | 前 5 个单元的合计占比下限（rotation）。 |
| `minParts` | `25` | 窗口最小句数。 |
| `rotationGuard` | `true` | 设 `false` 完全关闭 rotation 判据（只跑 `repeat`）。 |

一次折叠或一次签名跳过会以计数形式写入 `stderr`（不含推理文本）；一次既无折叠又无签名跳过的运行不写任何日志。设 `debug` 会额外记录每次 hook 的形状行以及截断后的命中片段。

## 安全

- **进程内异常 fail-open**：折叠过程中任何异常都不改动请求。它*不*拦截「provider 拒绝被改的请求」（见签名规则与下方限制）。
- **签名 / 脱敏思考会被跳过（启发式）。** `providerMetadata`（或 part 顶层键）里名字像签名 / 脱敏标记的 reasoning part 会原样保留，因为这类 provider 会拒绝被篡改的块。这是键名启发式，不是真正的签名校验。
- **`dryRun` 默认开**，因为阈值尚未在真实退化样本上校准。先用干跑、读日志；命中看起来对了再启用。
- 只有 reasoning 的 assistant 消息会原样保留。
- `tool-call` / `tool-result` part 不会被折叠。
- `logFile` 应为绝对路径；相对路径会相对进程工作目录解析。

## 状态与限制

- **检测阈值。** `repeat` 用上游默认值（在中文语料上校准）。`rotation` 在**英文**文本上校准（其短句门把 CJK 字符 —— 汉字、假名、谚文 —— 按词计）。两者都**未**在本项目的真实流量上重校。
- **提示缓存。** 重新折叠是字节稳定的，但「未改动的前缀是否仍命中缓存」**尚未量化**。
- **覆盖范围。** 只覆盖 agent loop（`context`）。`compaction`、`generate`、`title` 这几类请求不在内，所以这些请求运行时退化块仍可能被发出。
- **无替换提示。** 上游项目会把被折的那一步*替换*成一句提示（「不要重复；给出结论」）。本插件只去掉（或在 `foldMode: "blank"` 下清空）`reasoning` part，不给任何提示，所以「只删能否打断复读」**未测**。
- 带签名思考块的 provider（Anthropic 类）**未测**；这类 part 在任何模式下都跳过。`foldMode: "blank"` 用于在保留一个非签名 reasoning part 的同时清空其文本。
- 已在 `deepseek/deepseek-v4-pro` 与 `ollama-cloud/deepseek-v4-pro` 上验证（reasoning part 存在；折叠无报错完成）。

## 开发

```sh
node --test        # 纯函数单测，零依赖
```

结构：`lib/` 是与宿主无关的内核；`index.ts` 是 OpenCode 外壳。将来要支持别的 harness，只需在内核之上再加一个外壳（代理）。

运行时：`index.ts` 由 OpenCode v2（Bun）加载，不是 Node 入口 —— 包的根导出指向 `index.ts` 正是这个原因。`lib/` 内核零依赖、可在 Node 上跑，`node --test` 就是跑它，外加通过 Node 的 TypeScript stripping 直接跑 `index.ts`。

## 许可

MIT。`lib/detect.mjs` 的部分判据移植自另一个 MIT 项目；见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
