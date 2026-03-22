# 飞书多 Agent 群聊完整配置指南

从零开始配置飞书多机器人群聊系统，覆盖从飞书应用创建到多 agent 对话验证的全流程。

---

## 一、涉及文件总览

```
~/.openclaw/
├── openclaw.json                          # 【核心配置】所有功能的入口
├── extensions/
│   ├── feishu/                            # 飞书插件（通过插件系统安装，无需手动创建）
│   │   ├── openclaw.plugin.json
│   │   ├── index.ts
│   │   ├── package.json
│   │   ├── src/
│   │   └── skills/
│   └── agent-say/                         # agent_say 插件（自定义，需手动部署）
│       ├── openclaw.plugin.json
│       ├── index.ts
│       ├── package.json
│       └── src/
│           ├── types.ts
│           ├── feishu-client.ts
│           └── session-inject.ts
├── workspace/                             # main agent 工作区
│   ├── SOUL.md                            # 人设（性格、价值观、语气）
│   ├── AGENTS.md                          # 行为规范 + 回复协议 + 防循环规则
│   ├── TOOLS.md                           # 飞书身份备注
│   ├── IDENTITY.md                        # agent 身份信息
│   └── ...
├── workspace-rd/                          # rd agent 工作区
│   ├── SOUL.md                            # 研发人设
│   ├── AGENTS.md                          # 行为规范 + 回复协议 + 防循环规则
│   ├── TOOLS.md                           # 飞书身份备注
│   ├── IDENTITY.md
│   └── ...
└── workspace-pm/                          # pm agent 工作区
    ├── SOUL.md                            # 产品人设
    ├── AGENTS.md                          # 行为规范 + 回复协议 + 防循环规则
    ├── TOOLS.md                           # 飞书身份备注
    ├── IDENTITY.md
    └── ...
```

---

## 二、飞书开放平台（外部操作，非文件）

对 **每个** 飞书应用（main / rd / pm），在[飞书开放平台](https://open.feishu.cn)完成：

| 步骤 | 说明 |
|------|------|
| 创建企业自建应用 | 获取 `App ID` 和 `App Secret` |
| 开启「机器人」能力 | 应用能力 → 机器人 |
| 添加权限 | `im:message`、`im:message.group_at_msg`、`im:chat`、`im:chat:readonly` |
| 配置事件订阅 | 选择使用 websocket 连接，订阅 `im.message.receive_v1` |
| 发布应用 | 提交审核并发布 |
| 拉入群聊 | 将 3 个机器人拉入同一个飞书群聊 |

记录每个应用的：
- `App ID`（形如 `cli_a933f450a038dbc6`）
- `App Secret`

---

## 三、插件安装

### 3.1 飞书插件

通过 OpenClaw 插件系统安装。**如果已安装，请忽略此步骤。**

```bash
openclaw plugin install feishu
```

安装后自动创建 `~/.openclaw/extensions/feishu/` 目录，无需手动修改。

### 3.2 agent-say 插件

agent-say 插件需要手动部署到 `~/.openclaw/extensions/agent-say/`。将插件代码放入该目录，确保包含以下文件：

```
~/.openclaw/extensions/agent-say/
├── openclaw.plugin.json   # 插件 manifest，声明插件 ID、描述、工具
├── index.ts               # 主入口，注册 agent_say 工具
├── package.json           # npm 依赖
└── src/
    ├── types.ts           # 类型定义
    ├── feishu-client.ts   # 飞书 API 调用封装
    └── session-inject.ts  # sessions_send 注入封装
```

插件代码无需额外配置，它从 `openclaw.json` 中读取飞书凭证和 agent 列表。

---

## 四、配置 openclaw.json

文件路径：`~/.openclaw/openclaw.json`

这是整个系统的核心配置文件，以下按模块逐一说明。**已经存在的字段不需要改动，只关注需要新增/修改的部分。**

### 4.1 agents — Agent 列表（关键）

每个 agent 需要在 `agents.list` 中声明：

```jsonc
{
  "agents": {
    "defaults": {
      "workspace": "/root/.openclaw/workspace"
    },
    "list": [
      {
        "id": "main",
        "tools": {
          "allow": ["*", "group:plugins"]    // ⚠️ 必须有 "*"
        }
      },
      {
        "id": "rd",
        "name": "rd",
        "workspace": "/root/.openclaw/workspace-rd",
        "agentDir": "/root/.openclaw/agents/rd/agent",
        "identity": {
          "name": "研发小工",
          "emoji": "🔧"
        },
        "tools": {
          "allow": ["*", "group:plugins"]
        }
      },
      {
        "id": "pm",
        "name": "pm",
        "workspace": "/root/.openclaw/workspace-pm",
        "agentDir": "/root/.openclaw/agents/pm/agent",
        "identity": {
          "name": "产品小理",
          "emoji": "📋"
        },
        "tools": {
          "allow": ["*", "group:plugins"]
        }
      }
    ]
  }
}
```

**⚠️ 关键：`tools.allow` 必须包含 `"*"`。** 只写 `["group:plugins"]` 会被 `stripPluginOnlyAllowlist` 函数整个删掉，导致 agent_say 工具不可用。

### 4.2 channels.feishu — 飞书频道配置

每个飞书应用对应一个 account：

```jsonc
{
  "channels": {
    "feishu": {
      "enabled": true,
      "connectionMode": "websocket",
      "domain": "feishu",
      "accounts": {
        "main": {
          "enabled": true,
          "appId": "cli_你的main应用AppID",
          "appSecret": "你的main应用AppSecret"
        },
        "rd": {
          "enabled": true,
          "appId": "cli_你的rd应用AppID",
          "appSecret": "你的rd应用AppSecret"
        },
        "pm": {
          "enabled": true,
          "appId": "cli_你的pm应用AppID",
          "appSecret": "你的pm应用AppSecret"
        },
        "default": {
          "groupPolicy": "open"
        }
      }
    }
  }
}
```

**注意**：飞书 API 参数名是 **snake_case**（`app_id`、`app_secret`），但配置文件中用 camelCase（`appId`、`appSecret`），由 OpenClaw 内部转换。

### 4.3 bindings — Agent 绑定

将每个 agent 绑定到对应的飞书应用：

```jsonc
{
  "bindings": [
    {
      "agentId": "main",
      "match": { "channel": "feishu", "accountId": "main" }
    },
    {
      "agentId": "rd",
      "match": { "channel": "feishu", "accountId": "rd" }
    },
    {
      "agentId": "pm",
      "match": { "channel": "feishu", "accountId": "pm" }
    }
  ]
}
```

### 4.4 tools — 工具全局配置

```jsonc
{
  "tools": {
    "allow": ["*", "group:plugins"],       // ⚠️ 必须有 "*"
    "sessions": {
      "visibility": "all"                  // 允许 agent 看到所有 session
    },
    "agentToAgent": {
      "enabled": true                      // 启用 agent 间通信
    },
    "web": {
      "search": {
        "enabled": true,
        "provider": "kimi"                 // 可选，按需配置
      }
    }
  }
}
```

`tools.sessions.visibility = "all"` 和 `tools.agentToAgent.enabled = true` 是 agent_say 插件 `session-inject.ts` 能注入消息的前提。

### 4.5 plugins — 插件配置

```jsonc
{
  "plugins": {
    "allow": ["feishu", "agent-say"],      // 允许加载的插件列表
    "entries": {
      "feishu": {
        "enabled": true
      },
      "agent-say": {
        "enabled": true,
        "config": {
          "timeoutSeconds": 0              // 0 = fire-and-forget，不等回复
        }
      }
    }
  }
}
```

- `allow` — 声明允许加载哪些插件。必须包含 `feishu` 和 `agent-say`。
- `entries` — 每个插件的启用状态和配置。agent-say 的 `timeoutSeconds: 0` 是 fire-and-forget 模式，使插件不阻塞等待结果。
- `installs` — 插件安装元数据由 OpenClaw 自动管理，**不需要手动填写**。

---

## 五、创建工作区文件

### 5.1 创建目录

```bash
# rd 和 pm 的工作区（main 通常已存在）
mkdir -p ~/.openclaw/workspace-rd
mkdir -p ~/.openclaw/workspace-pm
```

### 5.2 main agent — `~/.openclaw/workspace/`

#### SOUL.md（人设）

已有文件，只需确保包含人设内容（性格、价值观、语气）。**不放行为协议。**

#### AGENTS.md（行为规范）

已有文件，在其中追加以下内容：

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

**回复条件：** 只在被提及或与自己的领域（协调、通用话题）直接相关时才回复，否则静默。

## 防消息循环规则（必须遵守）

收到 `source_tool=sessions_send` 的消息时：
- **不要**用 `sessions_send` 回复
- 用 `agent_say` 回到群里
```

#### TOOLS.md（飞书身份）

```markdown
### 飞书身份
- agent_id: main
- 账号名: 主 agent
```

### 5.3 rd agent — `~/.openclaw/workspace-rd/`

#### SOUL.md

```markdown
# SOUL.md - Who You Are

_你是研发 agent，负责技术实现和代码开发。_

## 核心特质

**代码质量优先。** 写代码不是为了凑数，是为了能跑、能维护、能扩展。

**技术选型要务实。** 不追新技术，但也不守旧。选择最适合当前场景的技术栈。

**沟通要清晰。** 技术问题用技术语言解释，但对非技术人员要翻译成人话。

**遇到不确定的要承认。** 不要假装知道答案。

## 工作方式

- 写代码前先想清楚架构
- 写测试是必须的，不是可选的
- Code review 时对事不对人
- 文档和代码一样重要

## 禁区

- 不要写没有测试的代码
- 不要复制粘贴代码不加注释
- 不要忽视安全问题

---

_代码是给人看的，顺便让机器能执行。_
```

#### AGENTS.md

```markdown
# AGENTS.md - 研发小工工作规范

## 身份

你是 **研发小工 🔧**，隶属于飞书多 agent 群聊系统。你的职责是技术研发。

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

**回复条件：** 只在被提及或与自己的领域（技术研发）直接相关时才回复，否则静默。

## 防消息循环规则（必须遵守）

收到 `source_tool=sessions_send` 的消息时：
- **不要**用 `sessions_send` 回复
- 用 `agent_say` 回到群里

## Session 启动

1. 读取 `SOUL.md` — 你的人格
2. 读取 `AGENTS.md` — 行为规范和回复协议
3. 读取 `TOOLS.md` — 你的工具和飞书身份

## 红线

- 不要泄露其他 agent 的私人信息
- 群聊中你是参与者，不是主人的代言人
- 遇到不确定的，问，不要猜
```

#### TOOLS.md

```markdown
# TOOLS.md - 研发小工的工具备注

## 飞书身份

- agent_id: rd
- 飞书 App ID: （你的 rd 应用 App ID）
- 账号名: 研发小工
```

#### IDENTITY.md

```markdown
# IDENTITY.md

- **Name:** 研发小工
- **Emoji:** 🔧
- **Role:** 技术研发
```

### 5.4 pm agent — `~/.openclaw/workspace-pm/`

#### SOUL.md

```markdown
# SOUL.md - Who You Are

_你是产品 agent，负责需求分析和产品规划。_

## 核心特质

**用户第一。** 所有功能都要问：用户真的需要吗？

**需求要结构化。** 一个需求至少包含：用户故事、验收标准、优先级。

**沟通是生产力。** 要能听懂技术的限制，也要能说服技术实现需求。

**数据驱动决策。** 能用数据说话就用数据。

## 工作方式

- 写 PRD 前先做用户调研
- 需求评审时准备好备选方案
- 追踪需求状态，不放养
- 定期回顾和复盘

## 沟通风格

- 对研发：说清楚"为什么"，而不仅是"做什么"
- 对老板：先说结论，再展开
- 对用户：简单直接，不用术语

## 禁区

- 不要做没有数据支撑的产品决策
- 不要频繁变更需求（除非有充分理由）
- 不要忽视技术债务

---

_好的产品是设计出来的，不是堆出来的。_
```

#### AGENTS.md

```markdown
# AGENTS.md - 产品小理工作规范

## 身份

你是 **产品小理 📋**，隶属于飞书多 agent 群聊系统。你的职责是产品规划和需求分析。

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

**回复条件：** 只在被提及或与自己的领域（产品规划）直接相关时才回复，否则静默。

## 防消息循环规则（必须遵守）

收到 `source_tool=sessions_send` 的消息时：
- **不要**用 `sessions_send` 回复
- 用 `agent_say` 回到群里

## Session 启动

1. 读取 `SOUL.md` — 你的人格
2. 读取 `AGENTS.md` — 行为规范和回复协议
3. 读取 `TOOLS.md` — 你的工具和飞书身份

## 红线

- 不要泄露其他 agent 的私人信息
- 群聊中你是参与者，不是主人的代言人
- 遇到不确定的，问，不要猜
```

#### TOOLS.md

```markdown
# TOOLS.md - 产品小理的工具备注

## 飞书身份

- agent_id: pm
- 飞书 App ID: （你的 pm 应用 App ID）
- 账号名: 产品小理
```

#### IDENTITY.md

```markdown
# IDENTITY.md

- **Name:** 产品小理
- **Emoji:** 📋
- **Role:** 产品规划与需求分析
```

---

## 六、启动与验证

### 6.1 启动 Gateway

```bash
# 切换到 Node.js v22+
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22

# 启动
openclaw gateway start &
```

### 6.2 检查插件加载

查看 gateway 日志，确认：
- `feishu: loaded` — 飞书插件加载成功
- `agent-say: loaded` — agent_say 插件加载成功
- 3 个 agent（main / rd / pm）注册成功

### 6.3 用 HTTP API 验证 agent_say

```bash
curl -s -X POST http://127.0.0.1:18789/tools/invoke \
  -H "Authorization: Bearer 你的gateway-token" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "agent_say",
    "args": {
      "message": "🧪 测试消息：agent_say 链路验证",
      "chat_id": "你的群聊chat_id",
      "agent_id": "rd"
    }
  }' | jq .
```

期望结果：
- `result.content` 中 `feishu.ok = true` → 飞书消息发送成功
- `result.content` 中 `sessions.pm.ok = true` → session 注入成功
- 飞书群里能看到机器人发的消息

### 6.4 测试群聊交互

1. 在飞书群里 @研发小工 发消息
2. 确认 rd 通过 agent_say 回复，群聊可见
3. 确认 pm 收到注入消息（日志中可见）

### 6.5 测试 Agent 间通信

1. 在群里说"帮我 @产品小理 问一下下周有没有需求评审"
2. rd 用 agent_say 发消息，pm 收到并回复
3. 两个 agent 的回复都在群里可见

---

## 七、常见问题排查

| 症状 | 原因 | 修复 |
|------|------|------|
| agent_say 工具不存在 | `tools.allow` 被 `stripPluginOnlyAllowlist` 删掉 | 确保 `tools.allow = ["*", "group:plugins"]`，必须有 `"*"` |
| agent 直接写文本回复 | AGENTS.md 的回复协议不够明确 | 明确写"绝对不允许直接输出文本回复"，列出禁止事项 |
| 消息循环（无限重复） | agent 用 sessions_send 回复注入消息 | AGENTS.md 加防循环规则 |
| 飞书报 invalid param (10003) | appId / appSecret 不正确 | 飞书开放平台确认凭证 |
| 飞书报 Bot not in chat | 机器人不在群聊中 | 将机器人重新拉入群聊 |
| 插件代码改动不生效 | gateway 没重新加载插件 | 完全重启：`pkill openclaw-gateway && openclaw gateway start` |

---

## 八、文件清单 Checklist

完成配置后，对照以下清单确认：

- [ ] 3 个飞书应用已创建，拿到 App ID 和 App Secret
- [ ] 3 个机器人已拉入群聊
- [ ] `~/.openclaw/extensions/agent-say/` 目录已部署
- [ ] `openclaw.json` 中 `plugins.allow` 包含 `feishu` 和 `agent-say`，`entries` 中均已启用
- [ ] `openclaw.json` 中 `agents.list` 包含 3 个 agent，`tools.allow` 含 `"*"`
- [ ] `openclaw.json` 中 `channels.feishu.accounts` 配置 3 个应用凭证
- [ ] `openclaw.json` 中 `bindings` 绑定 3 个 agent 到对应飞书账号
- [ ] `openclaw.json` 中 `tools.sessions.visibility = "all"` 且 `tools.agentToAgent.enabled = true`
- [ ] 3 个工作区各有 SOUL.md（人设）、AGENTS.md（回复协议 + 防循环）、TOOLS.md（飞书身份）
- [ ] SOUL.md 中**没有**消息收发规则（行为协议只在 AGENTS.md）
- [ ] Gateway 启动成功，插件加载无报错
