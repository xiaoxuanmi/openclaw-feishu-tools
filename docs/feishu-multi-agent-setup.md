# 飞书多 Agent 群聊方案总结

## 背景

在飞书群聊中部署多个 OpenClaw agent（main/rd/pm），每个 agent 绑定不同的飞书机器人账号。核心问题：**飞书平台限制导致同一个群里的机器人互相看不到对方发的消息**。因此需要一套机制让 agent 之间能互相通信。

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│                   飞书群聊                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ main 🦐  │  │  rd 🔧   │  │  pm 📋   │          │
│  │ (协调)    │  │ (研发)    │  │ (产品)    │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│       ↑             ↑             ↑                 │
│       │        飞书 API 发消息      │                 │
│       └─────────────┼─────────────┘                 │
│                     │                               │
│              agent_say 插件                         │
│         ┌───────────┴───────────┐                   │
│         │                       │                   │
│    飞书 API 发消息        sessions_send 注入         │
│    (群聊可见)             (agent 间通信)              │
└─────────────────────────────────────────────────────┘
```

## 双链路机制

agent_say 每次调用同时走两条链路：

1. **飞书 API 发消息** → 群聊里所有人类可见
2. **sessions_send 注入** → 其他 agent 的 session 收到消息（模拟飞书消息格式）

两条链路缺一不可：没有飞书发消息，人类看不到回复；没有 session 注入，agent 之间无法通信。

---

## 实现步骤

### 1. 飞书应用准备

每个 agent 需要一个独立的飞书应用（机器人）：

| Agent | 用途 | 飞书 App ID |
|-------|------|-------------|
| main 🦐 | 协调、通用话题 | cli_a933f450a038dbc6 |
| rd 🔧 | 技术研发 | cli_a9339376093bdbde |
| pm 📋 | 产品规划 | cli_a9338062dff81bcd |

每个应用需要：
- **获取 `app_id` 和 `app_secret`**
- **开启机器人能力**
- **添加权限**：`im:message:send_as_bot`（以机器人身份发消息）
- **将机器人拉入群聊**

### 2. OpenClaw 配置 (`openclaw.json`)

#### 2.1 飞书多账号配置

```json
{
  "channels": {
    "feishu": {
      "appId": "cli_a933f450a038dbc6",
      "appSecret": "main账号的appSecret",
      "enabled": true,
      "accounts": {
        "main": {
          "appId": "cli_a933f450a038dbc6",
          "appSecret": "main账号的appSecret"
        },
        "rd": {
          "appId": "cli_a9339376093bdbde",
          "appSecret": "rd账号的appSecret"
        },
        "pm": {
          "appId": "cli_a9338062dff81bcd",
          "appSecret": "pm账号的appSecret"
        }
      }
    }
  }
}
```

#### 2.2 多 Agent 配置

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "name": "大虾 🦐",
        "workspaceDir": "/root/.openclaw/workspace",
        "model": "xiaomi/mimo-v2-pro",
        "feishu": {
          "chatId": "oc_dc1dc5be09694709c0f7f86d002bfe5b",
          "mentionMode": "all"
        },
        "tools": {
          "allow": ["*", "group:plugins"]
        }
      },
      {
        "id": "rd",
        "name": "研发小工 🔧",
        "workspaceDir": "/root/.openclaw/workspace-rd",
        "model": "xiaomi/mimo-v2-pro",
        "feishu": {
          "chatId": "oc_dc1dc5be09694709c0f7f86d002bfe5b",
          "mentionMode": "all"
        },
        "tools": {
          "allow": ["*", "group:plugins"]
        }
      },
      {
        "id": "pm",
        "name": "产品小理 📋",
        "workspaceDir": "/root/.openclaw/workspace-pm",
        "model": "xiaomi/mimo-v2-pro",
        "feishu": {
          "chatId": "oc_dc1dc5be09694709c0f7f86d002bfe5b",
          "mentionMode": "all"
        },
        "tools": {
          "allow": ["*", "group:plugins"]
        }
      }
    ]
  }
}
```

#### 2.3 跨 Agent 通信配置

```json
{
  "tools": {
    "sessions": {
      "visibility": "all"
    },
    "agentToAgent": {
      "enabled": true
    },
    "allow": ["*", "group:plugins"]
  }
}
```

- `tools.sessions.visibility = "all"` — 允许 agent 访问其他 agent 的 session
- `tools.agentToAgent.enabled = true` — 允许 agent 之间通信
- `tools.allow = ["*", "group:plugins"]` — 暴露所有核心工具 + 插件工具（**关键！见踩坑 #5**）

#### 2.4 插件配置

```json
{
  "plugins": {
    "allow": ["feishu", "agent-say"],
    "entries": {
      "feishu": {
        "enabled": true
      },
      "agent-say": {
        "enabled": true,
        "config": {
          "timeoutSeconds": 0
        }
      }
    }
  }
}
```

- `plugins.allow` — 允许加载的插件列表
- `agent-say.config.timeoutSeconds: 0` — fire-and-forget 模式（不等待目标 agent 回复）

### 3. agent-say 插件实现

插件目录：`/root/.openclaw/extensions/agent-say/`

#### 3.1 文件结构

```
agent-say/
├── openclaw.plugin.json   # 插件 manifest
├── index.ts               # 主入口，注册 tool
├── package.json
└── src/
    ├── types.ts           # 类型定义
    ├── feishu-client.ts   # 飞书 API 调用
    └── session-inject.ts  # session 注入
```

#### 3.2 openclaw.plugin.json

```json
{
  "id": "agent-say",
  "name": "Agent Say",
  "description": "agent_say tool for multi-agent Feishu group chat",
  "configSchema": {
    "type": "object",
    "properties": {
      "timeoutSeconds": {
        "type": "number",
        "default": 0
      }
    }
  }
}
```

#### 3.3 核心逻辑 (index.ts)

```typescript
// 注册 agent_say 工具（必需工具，非 optional）
api.registerTool({
  name: "agent_say",
  description: "Broadcast to Feishu group + inject into other agents' sessions",
  parameters: {
    required: ["message", "chat_id", "agent_id"],
    properties: {
      message: { type: "string" },
      chat_id: { type: "string" },
      agent_id: { type: "string" },
      channel: { type: "string", default: "feishu" },
      targets: { type: "array", items: { type: "string" } },
      sender: { type: "string" }
    }
  },
  async execute(_id, params) {
    // 1. 飞书 API 发消息
    const { appId, appSecret } = resolveFeishuCredentials(api, params.agent_id);
    await sendFeishuMessage({ appId, appSecret, chatId: params.chat_id, text, mentionAll: true });
    
    // 2. 注入到其他 agent session
    for (const targetId of params.targets) {
      await injectSessionMessage({
        sessionKey: `agent:${targetId}:${channel}:group:${chatId}`,
        message: text,
        sourceSessionKey: `agent:${params.agent_id}:${channel}:group:${chatId}`,
        sourceChannel: channel,
        sourceTool: "agent_say"
      });
    }
  }
});
```

#### 3.4 飞书凭证解析

agent_id 自动映射到飞书账号：
- agent "rd" → accounts["rd"] 的 appId/appSecret
- agent "pm" → accounts["pm"] 的 appId/appSecret
- 找不到 → 回退到 "default" 账号

#### 3.5 Session 注入

调用 gateway HTTP API：

```bash
curl -X POST http://127.0.0.1:18789/tools/invoke \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "sessions_send",
    "args": {
      "sessionKey": "agent:pm:feishu:group:oc_xxx",
      "message": "[研发小工 🔧]: 消息内容",
      "timeoutSeconds": 0,
      "sourceSessionKey": "agent:rd:feishu:group:oc_xxx",
      "sourceChannel": "feishu",
      "sourceTool": "agent_say"
    }
  }'
```

- `timeoutSeconds: 0` = fire-and-forget，返回 `"accepted"` 而非 `"ok"`
- `sourceSessionKey` 确保目标 agent 收到消息时能看到正确的来源

### 4. AGENTS.md 行为规范

每个 agent 的 AGENTS.md 需要包含两部分：**回复协议**和**防循环规则**。

#### 回复协议

```markdown
## Reply Protocol (MUST follow)

**你只能通过 agent_say 工具调用来回复消息，绝对不允许直接输出文本回复。**

收到消息后，你的行为只有两个选择：
1. **调用 agent_say 工具** — 这是你回复的唯一方式
2. **输出 NO_REPLY** — 如果消息与你无关，静默不回复

**禁止事项：**
- ❌ 禁止直接写文本回复（如"收到，xxx"）
- ❌ 禁止用 sessions_send 直接回复
- ❌ 禁止在当前会话内输出回复性文字

**正确做法：**
- ✅ 想回复 → 调用 `agent_say` 工具
- ✅ 不想回复 → 输出 `NO_REPLY`

适用所有消息来源：飞书消息、sessions_send 注入、任何其他渠道。

**回复条件：** 只在被提及或与自己的领域直接相关时才回复，否则静默。
```

**关键点**：必须明确说"禁止直接输出文本回复"。如果只说"使用 agent_say 回复"，LLM 可能会理解为"直接写文本也算回复"。

#### 防循环规则

```markdown
## 防消息循环规则

收到 `source_tool=sessions_send` 的消息时：
- **不要**用 `sessions_send` 回复
- 用 `agent_say` 回到群里
```

> **注意**：SOUL.md 是人设（性格、价值观、语气），不放行为协议。行为规范放 AGENTS.md。

### 6. TOOLS.md 飞书凭证备注

每个 agent 的 TOOLS.md 记录自己的飞书身份：

```markdown
### 飞书身份
- agent_id: rd
- 飞书 App ID: cli_a9339376093bdbde
- 账号名: 研发小工
```

---

## 踩坑记录（重要！）

### 坑 #1：不要用 `tools.profile`

```json
// ❌ 错误！会把插件工具全部过滤掉
"tools": { "profile": "coding" }
```

`tools.profile` 是一个预设的工具白名单，只包含核心工具，不包含插件工具。设了之后 agent_say 就不见了。

### 坑 #2：飞书 API 参数名是 snake_case

```typescript
// ❌ 错误
{ app_id: appId, appSecret: appSecret }

// ✅ 正确
{ app_id: appId, app_secret: appSecret }
```

### 坑 #3：sessions_send 需要两组配置

```json
"tools": {
  "sessions": { "visibility": "all" },
  "agentToAgent": { "enabled": true }
}
```

两组都要开，缺一不可。

### 坑 #4：fire-and-forget 返回 "accepted" 不是 "ok"

```typescript
// timeoutSeconds: 0 时，返回 status: "accepted"
// 不要把 "accepted" 当错误处理
if (inner.status && inner.status !== "ok" && inner.status !== "accepted") {
  return { ok: false, error: ... };
}
```

### 坑 #5：`stripPluginOnlyAllowlist` — 纯插件 allowlist 会被删掉（最关键的坑！）

OpenClaw 源码中有个 `stripPluginOnlyAllowlist` 函数（`thread-bindings-SYAnWHuW.js:4185`），当 `tools.allow` **只包含插件工具引用**时，会把整个 allowlist 删掉。

```typescript
// 源码逻辑
function stripPluginOnlyAllowlist(policy, groups, coreTools) {
  let hasCoreEntry = false;
  for (const entry of normalized) {
    if (entry === "*") { hasCoreEntry = true; continue; }
    // ... 检查是否是核心工具
  }
  const strippedAllowlist = !hasCoreEntry;
  if (strippedAllowlist) {
    // 把 allow 整个删掉！
    return { policy: { ...policy, allow: undefined }, ... };
  }
}
```

**错误配置**（会被 strip）：
```json
"tools": { "allow": ["group:plugins"] }  // 纯插件引用 → 被删掉！
"tools": { "allow": ["agent-say"] }       // 纯插件引用 → 被删掉！
```

**正确配置**：
```json
"tools": { "allow": ["*", "group:plugins"] }  // * 是核心入口，不会被 strip
```

`*` 被 `compileGlobPattern` 编译成 `{ kind: "all" }`，匹配所有工具名，同时作为核心工具入口防止 strip。

### 坑 #6：插件代码用纯 TypeScript + 原生 fetch

不引入 Lark SDK，直接用原生 `fetch` 调用飞书 API。这样：
- 减少依赖
- 避免版本冲突
- 更容易调试

### 坑 #7：Session 缓存

agent 的 session 可能缓存旧的工具列表。改了配置后需要 **重启 gateway** 让新 session 读到新配置。用 gateway 的 `SIGUSR1` 信号可以热重载，但插件代码的改动可能需要完全重启。

### 坑 #8：源会话元数据

`sessions_send` 支持可选参数 `sourceSessionKey`、`sourceChannel`、`sourceTool`。不传的话 gateway 会用默认值（如 `agent:main:main`），导致目标 agent 看到错误的来源。

### 坑 #9：main 账号的 appSecret

main 账号的 `appSecret` 需要正确配置，否则飞书 API 会报 `invalid param`（错误码 10003）。如果 main 的飞书机器人不在群里，飞书会报 `Bot/User can NOT be out of the chat`。

### 坑 #10：不要在 SOUL.md 中定义 chat_id 或行为协议

SOUL.md 是人设文件，不应该包含 `chat_id`、`targets` 等运行时参数，也不应该放消息收发规则（这些属于行为协议，放 AGENTS.md）。之前 SOUL.md 里硬编码了这些内容，导致换群聊或调整目标时需要改 SOUL.md。正确的做法是：让 LLM 从上下文中获取 chat_id，或通过 `agent_say` 工具的参数传入。插件代码也不要在 `openclaw.plugin.json` 的 config 中硬编码 groups。

---

## 最终文件清单

```
~/.openclaw/
├── openclaw.json                    # 主配置（飞书多账号、agent列表、tools、plugins）
├── extensions/
│   ├── feishu/                      # 飞书插件（npm 安装）
│   └── agent-say/                   # agent_say 插件（本地开发）
│       ├── openclaw.plugin.json     # 插件 manifest
│       ├── index.ts                 # 主入口
│       ├── package.json
│       └── src/
│           ├── types.ts
│           ├── feishu-client.ts
│           └── session-inject.ts
├── workspace/                       # main agent 工作区
│   ├── SOUL.md                      # 人设（性格、价值观）
│   ├── AGENTS.md                    # 行为规范 + 回复协议 + 防循环规则
│   ├── IDENTITY.md
│   ├── USER.md
│   ├── TOOLS.md                     # 飞书凭证备注
│   └── MEMORY.md                    # 长期记忆
├── workspace-rd/                    # rd agent 工作区（同上结构）
└── workspace-pm/                    # pm agent 工作区（同上结构）
```

---

## 验证方法

1. **飞书消息可见性**：在群里 @rd 发消息，rd 应该回复（通过 agent_say）
2. **agent 间通信**：rd 用 agent_say 发消息，pm 应该收到并能回复
3. **防循环**：agent 收到 sessions_send 消息后，不会用 sessions_send 回复，而是用 agent_say 回到群里
4. **来源正确性**：agent 收到注入消息时，sourceSessionKey 应该显示正确的来源 agent
5. **HTTP API 验证**：
   ```bash
   curl -X POST http://127.0.0.1:18789/tools/invoke \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"tool":"agent_say","args":{"message":"测试","chat_id":"oc_xxx","agent_id":"rd"}}'
   ```

---

## 总结

整个方案的核心是一个 **agent_say 插件**，它通过 **飞书 API + sessions_send 双链路** 解决了飞书多机器人互相看不到消息的问题。配置要点是 **tools.allow 必须包含 `"*"` 以防止 stripPluginOnlyAllowlist 过滤掉插件工具**。每个 agent 的 AGENTS.md 需要严格规定 **只能通过 agent_say 回复，禁止直接输出文本**（SOUL.md 只放人设，不放行为协议）。
