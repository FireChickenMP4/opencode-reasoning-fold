# opencode-reasoning-guard · 探针报告 (v1)

日期: 2026-10-15
环境: opencode v2.0.28 / Node v25.2.1 / Windows
探针工程: `%TEMP%\opencode\dgprobe` (一次性, 未改动任何全局配置)
被测模型: ollama-cloud/deepseek-v4.1-flash, ollama-cloud/deepseek-v4-pro,
          deepseek/deepseek-flash, deepseek/deepseek-v4-pro

---

## 0. 目标

回答简报里标注"动手前先实测"的项, 外加一个它没提的风险:

1. `context` hook 的 `event.messages` 到底是什么结构; `reasoning` 在不在里面、什么形状
2. 各 provider 对"删改 reasoning 块"的容忍度 (简报 §4 说差异极大)
3. 折叠会不会破坏 `tool_use <-> tool_result` 配对 (简报 §4.1 的核心担忧)
4. (额外) "只改出站不落存储" -> 每步都从持久化历史重算, 对折叠的实现有何约束

## 1. 方法

- 在 `.opencode/plugins/probe/index.ts` 注册 `ctx.session.hook("context", fn)`, **只读** dump:
  每条消息的 role、content 里每个 part 的 `type`、reasoning part 的 keys 与文本长度。
- 用 `opencode run` 发**需要工具调用**的提示词, 制造多步回合, 让上一步的 reasoning
  出现在下一次出站消息里 (`messages` 会从 1 涨到 3)。
- 加环境开关 `DGPROBE_STRIP=1`: 在 hook 里**删掉** assistant 消息中的 reasoning part,
  观察模型调用是否报错、回合是否正常结束。
- 跨轮重放: 对同一个 session 用 `-s <id>` 追加一轮, 看在役历史里是否还带 reasoning。

## 2. 结果

### 2.1 插件加载与 hook 触发 [完成]

- `.opencode/plugins/<name>/index.ts` 被自动加载, `setup` 被调用。
- `ctx` 域确认: `app, location, options, agent, aisdk, command, credential, event,
  experimental, generate, model, provider, integration, mcp, permission, plugin,
  reference, rpc, skill, storage, tool, vcs, websearch, worktree, session, shell`。
- `ctx.session.hook("context", fn)` 返回注册对象, 回调被调用。
  官方类型契约 (`SessionContextHook`) 字段: `sessionID, agent, model, system,
  messages, tools, options`。

### 2.2 messages 形状 = AI SDK 规范消息 [完成]

单步 (仅用户输入) 时 `messages` 长度 1; 多步时累积。实测一条完整的工具回合出站:

```
msg[0] role=user      keys=id|role|content|metadata   content=[text]
msg[1] role=assistant keys=id|role|content|metadata   content=[reasoning, tool-call]
        REASONING-PART keys=type,text,providerMetadata   textLen=59
        TOOL-PART      keys=type,id,name,input,providerExecuted,providerMetadata  name=shell
msg[2] role=tool      keys=role|content               content=[tool-result]
```

关键点: **`reasoning` 是一个 `{ type:"reasoning", text, providerMetadata }` 的普通对象**,
明文、可读、可删改 — 不是不透明密文块。且它与 `tool-call` 是**同一条 assistant 消息里
两个并列的 part**。

### 2.3 provider 差异 — 按"模型变体"而非"来源" [完成]

| provider / model | reasoning part | providerMetadata 键 |
|---|---|---|
| ollama-cloud/deepseek-v4.1-flash | 有 | `ollama-cloud` |
| ollama-cloud/deepseek-v4-pro | 有 | `ollama-cloud` |
| deepseek/deepseek-v4-pro | 有 | `deepseek` |
| deepseek/deepseek-flash | **无** (content 只有 `[text, tool-call]`) | - |

结论: 不是"ollama 源 vs 官方"的简单二分。两个源在 `-pro` 上都回传 reasoning;
差异出现在 **`-flash` 变体** (官方 flash 不回传)。**不能靠 provider 名硬编码判断**,
必须在运行时探测"这条消息里有没有 reasoning part"。

### 2.4 删除 reasoning part 是否安全 [完成, 限于 deepseek 系]

`DGPROBE_STRIP=1` 下, 第二步出站消息从 `[reasoning, tool-call]` 变为 `[text, tool-call]`:

```
msg[1] role=assistant content=[text, tool-call]     <- reasoning 已被移除
```

模型调用 **成功 (EXIT=0)**, 回合正常结束并给出正确答案, `tool-call` / `tool-result`
配对完好。

### 2.5 跨轮重放 [完成]

对同一 session 追加一轮, 第二轮 `messages=5`:

```
msg[1] role=assistant content=[reasoning, tool-call]   <- 第一轮的 reasoning 原样再现
        REASONING-PART keys=type,text,providerMetadata   textLen=59 (与首轮一致)
```

-> 历史 reasoning **每轮原样重放**, 印证简报的机制假设。

## 3. 结论

- **可行性成立**: reasoning 就在出站消息里, 且是可直接删改的 part。
- **折叠单位 = part** (删/清 reasoning part), 因此**不会破坏工具配对** — 简报 §4.1
  的担忧比实际更重。
- **必须运行时探测**: 有无 reasoning part 决定"工作 / 待机", 不能按 provider 名判断。
- **必须确定性折叠**: hook 每步都从持久化历史重算 (见 2.5 与"只改出站"), 若折叠结果
  每步不稳定, 缓存会每步抖动。

## 4. 未测 / 风险 (实现阶段需补)

1. **Anthropic 等带签名 thinking**: `providerMetadata` 里可能带签名/密文, 删改会不会被拒
   —— 未测。需要保留"置空 text 但保留 part"的逃生开关。
2. **缓存收益未量化**: "只折尾部、前面稳定前缀仍命中"仍是推断, 需要真实用量面板对比。
3. **判据真机校准**: 本机没有长会话污染样本, 上游阈值 (`minRepeats=25 / minShare=0.20`;
   英文轮换 `shortShare>=0.35 & topUnitShare>=0.50`) 未复现召回/误报。
4. **流式 reasoning 是否可读**: 事件流里 reasoning 是否逐块可读 (未来急停阀用) 未测。

---

# 简报 vs 实测 · 差异清单

| # | 简报位置 | 简报说法 | 实测 | 影响 |
|---|---|---|---|---|
| 1 | §3.1 | `Plugin.define({id, setup})` | 官方文档确认; 且 `export default {id, setup}` 也能加载 (你本机 notify-* 即此形态) | 无 (可选任一种) |
| 2 | §3.1 | `context` hook 可改 system/messages/tools/options | 确认; 另确认 `messages` 是 AI SDK 规范 `Message[]` | 无 |
| 3 | §4.1 | 默认不折当前 live turn, 否则破坏 tool_use<->tool_result 配对 | **偏保守**: 折的是 part, 与工具配对无关; 且 hook 在派发前跑, 看不到"正在生成"的那发 | 折叠策略更简单, 单位=part |
| 4 | §3.2 / §1 | 跨 harness 要做本地代理 (HTTP/SSE/多协议) | **opencode 内不需要代理**: v2 原生有 `http.request`/`http.response`/`model.request`/`experimental.ws.*` hook | 路线 A 更优; 代理仅在真正跨 harness 时才有价值 |
| 5 | §3.3 | "清库存"要另做一个 auto-checkpoint 插件 | opencode v2 有原生 `compaction` hook + 原生压缩 | 插件只做折叠, 压缩交还本体 (正是定位句) |
| 6 | §2 / §6 | 上游 `dsh-degeneration-kit` 可参考 (含代码) | 它是**另一个宿主 DSH** (`@deepseek-ai/dsh-agent`, 用 `ctx.on('agent/assistant-stream')` + `agent.cancel`) | 只有纯判据 `detect()`/`rotationHit()` 可移植, 集成代码不可用 |
| 7 | §2 | `reasoning` 是否在 `event.messages`、形状如何 (标未验) | **已验**: `{type:"reasoning", text, providerMetadata}`, 明文可删 | 前提成立 |
| 8 | §4 | 各 provider 对删改 thinking 容忍度差异极大 | deepseek 系 (含 ollama 源) **可安全删除**; 签名类未测 | 需运行时探测 + 逃生开关 |
| 9 | §4 | "只改出站不落存储"值得验 | 间接确认: 跨轮 reasoning 原样重放 = 每步都从持久化历史重算 | 折叠必须确定性、幂等 |
| 10 | §3.4 | "只折尾部 -> 前缀仍命中"是推断 | 仍未量化 | 列为待测 |

---

# 对方案的设计决策 (由实证推出)

1. **折叠单位 = reasoning part**, 不删整条消息 -> 天然不破工具配对。
2. **运行时探测**有无 reasoning part 决定工作/待机, 不按 provider 名硬编码
   (实测 flash 变体差异)。
3. **确定性 + 幂等**折叠: 相同历史每步折出相同字节, 缓存不抖。
4. **fail-open**: 任何异常原样放行。
5. **默认 dryRun**: 先只记日志 (命中、块长、占比), 确认无误伤再开真折。
6. **只折"退化"的块**, 正常思考保留。
7. 折叠默认 = 移除 reasoning part; 预留"置空 text 保留 part"给签名类 provider。
8. **一个包, 内核纯函数**: `foldDegenerate(messages, opts) -> messages` +
   `detect(text, opts) -> hit|null`; opencode 插件只是外壳 (为将来代理复用留缝)。

## 附录 · 复现

```
# 探针工程
%TEMP%\opencode\dgprobe\.opencode\plugins\probe\index.ts
# 日志
%TEMP%\opencode\dgprobe\shape.log
# 真折测试
$env:DGPROBE_STRIP="1"; opencode run -m <provider/model> --auto "Use the shell tool to run: echo x. Then tell me the output."
```
