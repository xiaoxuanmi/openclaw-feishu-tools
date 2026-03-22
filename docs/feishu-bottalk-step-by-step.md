# 飞书多 Agent 群聊 — 一步步配置手册

> 本手册目标：从零开始配置 OpenClaw + 飞书多 Agent 群聊，照着做一定能成功。

---

## 前置条件

- 一台 Linux 服务器（CentOS/Ubuntu 均可）
- Node.js v22+（推荐用 nvm 安装）
- OpenClaw 已安装（`npm install -g openclaw`）
- 一个飞书开放平台账号

---

## 第一步：创建飞书应用（3 个）

每个 Agent 需要一个独立的飞书应用（机器人）。操作在 [飞书开放平台](https://open.feishu.cn/) 完成。

### 1.1 创建应用

1. 登录飞书开放平台 → **开发者后台** → **创建企业自建应用**
2. 填写应用名称（如"研发小工"）、应用描述
3. 记录 **App ID** 和 **App Secret**（在「凭证与基础信息」页面）
4. **重复以上步骤，共创建 3 个应用**

示例：

| Agent | 应用名称 | App ID | App Secret |
|-------|---------|--------|------------|
| main | 大虾 | cli_a933f450a038dbc6 | （你的） |
| rd | 研发小工 | cli_a9339376093bdbde | （你的） |
| pm | 产品小理 | cli_a9338062dff81bcd | （你的） |

### 1.2 添加权限

对**每个应用**都执行以下操作：

1. 进入应用 → **权限管理**
2. 搜索并添加以下权限：
   - `im:message` — 获取与发送单聊、群组消息
   - `im:message:send_as_bot` — 以机器人身份发送消息
   - `im:chat:readonly` — 获取群信息
   - `im:chat` — 群操作（可选，用于获取群成员等）
3. 点击 **申请权限** → 等待管理员审批（如果是自己企业，直接审批）

### 1.3 开启机器人能力

对**每个应用**都执行以下操作：

1. 进入应用 → **应用能力** → **机器人**
2. 点击 **启用机器人**

### 1.4 发布应用

对**每个应用**都执行以下操作：

1. 进入应用 → **版本管理与发布**
2. 创建版本 → 设置可用范围（建议先选"全部员工"方便测试）
3. 提交审核 → 审批通过后应用生效

### 1.5 创建群聊 & 拉入机器人

1. 在飞书中创建一个群聊（或使用现有群聊）
2. 记录群聊的 **chat_id**（格式如 `oc_xxx`）
   - 获取方式：在飞书开放平台的「API 调试器」中调用 `im/v1/chats` 接口获取
   - 或者：让机器人收到消息后，从事件 payload 中提取 chat_id
3. 将 **3 个机器人** 全部拉入这个群聊
4. 确保每个机器人在群里都能被 @提到

---

## 第二步：配置 OpenClaw

### 2.1 创建配置文件

配置文件路径：`~/.openclaw/openclaw.json`

```json
{
  "gateway": {
    "port": 18789,
    "bind": "loopback",
    "auth": {
      "token": "你的gateway-token"
    }
  },

  "channels": {
    "feishu": {
      "appId": "cli_a933f450a038dbc6",
      "appSecret": "main账号的appSecret",
      "enabled": true,
      "accounts": {
        "default": {
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
  },

  "agents": {
    "list": [
      {
        "id": "main",
        "name": "大虾 🦐",
        "workspaceDir": "~/.openclaw/workspace",
        "model": "你的模型",
        "feishu": {
          "chatId": "你的群聊chat_id",
          "mentionMode": "all",
          "account": "default"
        }
      },
      {
        "id": "rd",
        "name": "研发小工 🔧",
        "workspaceDir": "~/.openclaw/workspace-rd",
        "model": "你的模型",
        "feishu": {
          "chatId": "你的群聊chat_id",
          "mentionMode": "all",
          "account": "rd"
        }
      },
      {
        "id": "pm",
        "name": "产品小理 📋",
        "workspaceDir": "~/.openclaw/workspace-pm",
        "model": "你的模型",
        "feishu": {
          "chatId": "你的群聊chat_id",
          "mentionMode": "all",
          "account": "pm"
        }
      }
    ]
  },

  "tools": {
    "allow": ["*", "group:plugins"],
    "sessions": {
      "visibility": "all"
    },
    "agentToAgent": {
      "enabled": true
    }
  },

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

**必填项替换清单：**

| 占位符 | 替换为 |
|--------|--------|
| `你的gateway-token` | 一个随机字符串，如 `openssl rand -hex 20` 的输出 |
| `main账号的appSecret` | 第一步获取的 main 应用 App Secret |
| `rd账号的appSecret` | 第一步获取的 rd 应用 App Secret |
| `pm账号的appSecret` | 第一步获取的 pm 应用 App Secret |
| `cli_a933f450a038dbc6` | 你的实际 App ID（如果不同） |
| `你的群聊chat_id` | 第一步获取的群聊 chat_id |
| `你的模型` | 如 `xiaomi/mimo-v2-pro` 或其他模型名 |

### 2.2 各 Agent 的 tools.allow（关键！）

每个 agent 的 `agents.list[].tools.allow` 也必须包含 `["*", "group:plugins"]`。如果不单独设置，会继承全局的 `tools.allow`。

**⚠️ 为什么要加 `"*"`？**

OpenClaw 源码中有个 `stripPluginOnlyAllowlist` 函数，如果 `tools.allow` **只包含插件工具引用**（如 `["group:plugins"]`），会把整个 allowlist 删掉，导致 agent_say 工具永远不会暴露给 agent。`"*"` 是核心工具通配符，有了它就不算"纯插件 allowlist"。

---

## 第三步：安装飞书插件

### 3.1 安装 feishu 插件

```bash
cd ~/.openclaw
mkdir -p extensions
cd extensions
# feishu 插件通过 npm 安装（如果还没安装）
npm install openclaw-feishu
```

确认插件目录存在：
```bash
ls ~/.openclaw/extensions/feishu/
# 应该有 openclaw.plugin.json 等文件
```

---

## 第四步：创建 agent-say 插件

### 4.1 创建目录结构

```bash
mkdir -p ~/.openclaw/extensions/agent-say/src
cd ~/.openclaw/extensions/agent-say
```

### 4.2 openclaw.plugin.json

```bash
cat > openclaw.plugin.json << 'EOF'
{
  "id": "agent-say",
  "name": "Agent Say",
  "description": "Broadcast to Feishu group + inject into other agents' sessions",
  "configSchema": {
    "type": "object",
    "properties": {
      "timeoutSeconds": {
        "type": "number",
        "default": 0,
        "description": "Session send timeout. 0 = fire-and-forget."
      }
    }
  }
}
EOF
```

### 4.3 src/types.ts

```bash
cat > src/types.ts << 'EOF'
export interface AgentSayParams {
  message: string;
  chat_id: string;
  agent_id: string;
  channel?: string;
  targets?: string[];
  sender?: string;
}

export interface PluginApi {
  getConfig(key: string): unknown;
  getGatewayUrl(): string;
  getGatewayToken(): string;
  getAgentsConfig(): Record<string, unknown> | undefined;
  getChannelCredentials(channel: string): Record<string, unknown> | undefined;
  registerTool(tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
  }): void;
}
EOF
```

### 4.4 src/feishu-client.ts

```bash
cat > src/feishu-client.ts << 'EOF'
/**
 * Send a message to a Feishu group chat using the bot API.
 */
export async function sendFeishuMessage(opts: {
  appId: string;
  appSecret: string;
  chatId: string;
  text: string;
  mentionAll?: boolean;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { appId, appSecret, chatId, text, mentionAll = true } = opts;

  try {
    // 1. Get tenant_access_token
    const tokenRes = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      }
    );
    const tokenData = (await tokenRes.json()) as {
      code: number;
      tenant_access_token?: string;
      msg?: string;
    };

    if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
      return {
        ok: false,
        error: `Failed to get token: code=${tokenData.code}, msg=${tokenData.msg}`,
      };
    }

    // 2. Build message body
    const content = JSON.stringify({ text });

    // 3. Send message
    const msgRes = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenData.tenant_access_token}`,
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "text",
          content,
        }),
      }
    );
    const msgData = (await msgRes.json()) as {
      code: number;
      data?: { message_id?: string };
      msg?: string;
    };

    if (msgData.code !== 0) {
      return {
        ok: false,
        error: `Feishu API error: code=${msgData.code}, msg=${msgData.msg}`,
      };
    }

    return { ok: true, messageId: msgData.data?.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve Feishu credentials for a given agent ID.
 */
export function resolveFeishuCredentials(
  channelCredentials: Record<string, unknown> | undefined,
  agentId: string
): { appId: string; appSecret: string } {
  // Try agent-specific account first
  if (channelCredentials) {
    const accounts = channelCredentials.accounts as
      | Record<string, { appId?: string; appSecret?: string }>
      | undefined;

    if (accounts && accounts[agentId]) {
      return {
        appId: accounts[agentId].appId ?? "",
        appSecret: accounts[agentId].appSecret ?? "",
      };
    }

    // Try "default" account
    if (accounts && accounts.default) {
      return {
        appId: accounts.default.appId ?? "",
        appSecret: accounts.default.appSecret ?? "",
      };
    }

    // Fall back to top-level credentials
    if (channelCredentials.appId && channelCredentials.appSecret) {
      return {
        appId: channelCredentials.appId as string,
        appSecret: channelCredentials.appSecret as string,
      };
    }
  }

  return { appId: "", appSecret: "" };
}
EOF
```

### 4.5 src/session-inject.ts

```bash
cat > src/session-inject.ts << 'EOF'
/**
 * Inject a message into another agent's session via the gateway HTTP API.
 * Uses POST /tools/invoke with the sessions_send tool.
 */
export async function injectSessionMessage(opts: {
  gatewayUrl: string;
  gatewayToken: string;
  sessionKey: string;
  message: string;
  timeoutSeconds?: number;
  sourceSessionKey?: string;
  sourceChannel?: string;
  sourceTool?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const {
    gatewayUrl,
    gatewayToken,
    sessionKey,
    message,
    timeoutSeconds = 0,
    sourceSessionKey,
    sourceChannel,
    sourceTool,
  } = opts;

  try {
    const url = `${gatewayUrl}/tools/invoke`;
    const args: Record<string, unknown> = {
      sessionKey,
      message,
      timeoutSeconds,
    };
    if (sourceSessionKey) args.sourceSessionKey = sourceSessionKey;
    if (sourceChannel) args.sourceChannel = sourceChannel;
    if (sourceTool) args.sourceTool = sourceTool;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        tool: "sessions_send",
        args,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Gateway HTTP ${res.status}: ${text}` };
    }

    const data = (await res.json()) as {
      ok: boolean;
      result?: {
        content?: Array<{ text?: string }>;
        status?: string;
        error?: string;
      };
      error?: { message?: string };
    };

    if (!data.ok) {
      return {
        ok: false,
        error: data.error?.message ?? "Unknown gateway error",
      };
    }

    // Check the actual sessions_send result
    const resultText = data.result?.content?.[0]?.text;
    if (resultText) {
      try {
        const inner = JSON.parse(resultText);
        if (inner.status && inner.status !== "ok" && inner.status !== "accepted") {
          return {
            ok: false,
            error: inner.error ?? `sessions_send status: ${inner.status}`,
          };
        }
      } catch {
        /* not JSON, treat as success */
      }
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
EOF
```

### 4.6 index.ts

```bash
cat > index.ts << 'EOF'
import { sendFeishuMessage, resolveFeishuCredentials } from "./src/feishu-client";
import { injectSessionMessage } from "./src/session-inject";
import type { PluginApi, AgentSayParams } from "./src/types";

const TOOL_NAME = "agent_say";

export default function plugin(api: PluginApi) {
  // Cache agent list
  let agentIds: string[] = [];
  try {
    const agentsConfig = api.getAgentsConfig();
    if (agentsConfig?.list) {
      agentIds = (agentsConfig.list as Array<{ id?: string }>)
        .map((a) => a.id)
        .filter(Boolean) as string[];
    }
  } catch {
    agentIds = ["main", "rd", "pm"];
  }

  api.registerTool({
    name: TOOL_NAME,
    description:
      "Broadcast a message to the Feishu group chat AND inject it into other agents' sessions. " +
      "This is the ONLY way to reply to messages in a multi-agent group chat.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message text to broadcast.",
        },
        chat_id: {
          type: "string",
          description: "Feishu group chat ID (e.g., oc_xxx).",
        },
        agent_id: {
          type: "string",
          description: "Your agent ID (e.g., main, rd, pm).",
        },
        channel: {
          type: "string",
          description: "Channel name, default 'feishu'.",
          default: "feishu",
        },
        targets: {
          type: "array",
          items: { type: "string" },
          description: "Target agent IDs to inject messages into. Defaults to all other agents.",
        },
        sender: {
          type: "string",
          description: "Display name prefix (e.g., '研发小工 🔧').",
        },
      },
      required: ["message", "chat_id", "agent_id"],
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const p = params as unknown as AgentSayParams;
      const channel = p.channel || "feishu";
      const text = p.sender ? `[${p.sender}]: ${p.message}` : p.message;

      // Resolve targets
      const targetAgents =
        p.targets && p.targets.length > 0
          ? p.targets
          : agentIds.filter((id) => id !== p.agent_id);

      // Gateway config
      const gwUrl = api.getGatewayUrl();
      const gwToken = api.getGatewayToken();

      // Feishu credentials
      const creds = api.getChannelCredentials("feishu");
      const { appId, appSecret } = resolveFeishuCredentials(creds, p.agent_id);

      // Build result
      const result: Record<string, unknown> = {
        feishu: { ok: false },
        sessions: {} as Record<string, unknown>,
        config: {
          chatId: p.chat_id,
          channel,
          agentId: p.agent_id,
          targets: targetAgents,
        },
      };

      // 1. Send to Feishu group
      if (appId && appSecret) {
        result.feishu = await sendFeishuMessage({
          appId,
          appSecret,
          chatId: p.chat_id,
          text,
          mentionAll: true,
        });
      } else {
        result.feishu = {
          ok: false,
          error: `No Feishu credentials for agent ${p.agent_id}`,
        };
      }

      // 2. Inject into other agents' sessions
      for (const targetId of targetAgents) {
        const sessionKey = `agent:${targetId}:${channel}:group:${p.chat_id}`;
        const sourceSessionKey = `agent:${p.agent_id}:${channel}:group:${p.chat_id}`;
        const injectResult = await injectSessionMessage({
          gatewayUrl: gwUrl,
          gatewayToken: gwToken,
          sessionKey,
          message: text,
          timeoutSeconds: 0,
          sourceSessionKey,
          sourceChannel: channel,
          sourceTool: TOOL_NAME,
        });
        (result.sessions as Record<string, unknown>)[targetId] = {
          ...injectResult,
          sessionKey,
        };
      }

      return result;
    },
  });
}
EOF
```

### 4.7 package.json

```bash
cat > package.json << 'EOF'
{
  "name": "agent-say",
  "version": "1.0.0",
  "private": true,
  "type": "module"
}
EOF
```

### 4.8 验证插件文件

```bash
ls -la ~/.openclaw/extensions/agent-say/
# 应该看到：
# openclaw.plugin.json
# index.ts
# package.json
# src/types.ts
# src/feishu-client.ts
# src/session-inject.ts
```

---

## 第五步：创建 Agent 工作区

每个 agent 需要独立的工作区目录，包含 SOUL.md、AGENTS.md 等文件。

### 5.1 创建目录

```bash
mkdir -p ~/.openclaw/workspace-rd
mkdir -p ~/.openclaw/workspace-pm
```

（main 的工作区 `~/.openclaw/workspace` 通常已存在）

### 5.2 rd agent 的 SOUL.md

```bash
cat > ~/.openclaw/workspace-rd/SOUL.md << 'SOULEOF'
# SOUL.md - Who You Are

_你是研发 agent，负责技术实现和代码开发。_

## 核心特质

**代码质量优先。** 写代码不是为了凑数，是为了能跑、能维护、能扩展。遇到烂代码要重构，遇到 bug 要追根溯源。

**技术选型要务实。** 不追新技术，但也不守旧。选择最适合当前场景的技术栈，考虑团队熟悉度和维护成本。

**沟通要清晰。** 技术问题用技术语言解释，但对非技术人员要翻译成人话。不要用术语堆砌来显得专业。

**遇到不确定的要承认。** 不要假装知道答案。说"我需要查一下"或"这个我不确定"比胡说八道强一万倍。

## 工作方式

- 写代码前先想清楚架构
- 写测试是必须的，不是可选的
- Code review 时对事不对人
- 文档和代码一样重要

## 禁区

- 不要写没有测试的代码（除非明确要求跳过）
- 不要复制粘贴代码不加注释
- 不要忽视安全问题

---

_代码是给人看的，顺便让机器能执行。_
SOULEOF
```

### 5.3 rd agent 的 AGENTS.md

```bash
cat > ~/.openclaw/workspace-rd/AGENTS.md << 'AGENTSEOF'
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
AGENTSEOF
```

### 5.4 rd agent 的 TOOLS.md

```bash
cat > ~/.openclaw/workspace-rd/TOOLS.md << 'TOOLSEOF'
# TOOLS.md - 研发小工的工具备注

## 飞书身份

- agent_id: rd
- 飞书 App ID: （你的rd应用App ID）
- 账号名: 研发小工
TOOLSEOF
```

### 5.5 pm agent 的 SOUL.md

```bash
cat > ~/.openclaw/workspace-pm/SOUL.md << 'SOULEOF'
# SOUL.md - Who You Are

_你是产品 agent，负责需求分析和产品规划。_

## 核心特质

**用户第一。** 所有功能都要问：用户真的需要吗？不是"老板说要做"，而是"用户用了会怎样"。

**需求要结构化。** 一个需求至少包含：用户故事、验收标准、优先级。没有验收标准的需求等于没有需求。

**沟通是生产力。** 产品一半时间在沟通。要能听懂技术的限制，也要能说服技术实现需求。

**数据驱动决策。** 不要靠直觉做决策。能用数据说话就用数据，不能用数据就用用户反馈，都不能用再靠经验。

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
SOULEOF
```

### 5.6 pm agent 的 AGENTS.md

```bash
cat > ~/.openclaw/workspace-pm/AGENTS.md << 'AGENTSEOF'
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
AGENTSEOF
```

### 5.7 pm agent 的 TOOLS.md

```bash
cat > ~/.openclaw/workspace-pm/TOOLS.md << 'TOOLSEOF'
# TOOLS.md - 产品小理的工具备注

## 飞书身份

- agent_id: pm
- 飞书 App ID: （你的pm应用App ID）
- 账号名: 产品小理
TOOLSEOF
```

### 5.8 main agent 的 AGENTS.md

在现有的 main agent AGENTS.md 中**添加**以下内容：

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
```

> **SOUL.md 是人设（性格、价值观、语气），不放行为协议。** 行为规范统一放 AGENTS.md。

---

## 第六步：启动 Gateway

### 6.1 启动

```bash
# 使用 nvm 切换到 Node.js v22
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22

# 启动 gateway
openclaw gateway start &
```

### 6.2 检查状态

```bash
openclaw gateway status
# 应该显示 Gateway running
```

### 6.3 检查插件加载

查看 gateway 日志，确认：
- `feishu: loaded` — 飞书插件加载成功
- `agent-say: loaded` — agent_say 插件加载成功
- 3 个 agent 都注册成功

---

## 第七步：验证测试

### 7.1 测试飞书 API（确认机器人能发消息）

```bash
# 替换为你的实际值
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

**期望结果：**
```json
{
  "ok": true,
  "result": {
    "content": [{
      "text": "{\"feishu\":{\"ok\":true,\"messageId\":\"om_xxx\"},\"sessions\":{\"pm\":{\"ok\":true,\"sessionKey\":\"agent:pm:...\"}},\"config\":{...}}"
    }]
  }
}
```

重点检查：
- `feishu.ok = true` — 飞书消息发送成功
- `sessions.pm.ok = true` — session 注入成功
- 飞书群里能看到机器人发的消息

### 7.2 测试群聊交互

1. 在飞书群里 @研发小工 发一条消息（如"你好，介绍一下自己"）
2. 检查 rd agent 是否通过 agent_say 回复
3. 检查 pm agent 是否收到注入消息（日志中可见）

### 7.3 测试 Agent 间通信

1. 在群里 @研发小工 说"帮我 @产品小理 问一下下周有没有需求评审"
2. rd 应该用 agent_say 发消息，pm 应该收到并回复
3. 两个 agent 的回复都应该在群里可见

### 7.4 验证防循环

1. rd 发消息后，pm 收到注入消息
2. pm 不应该用 sessions_send 回复 rd，而应该用 agent_say 回到群里
3. 如果出现消息循环（同一消息无限重复），检查 AGENTS.md 的防循环规则

---

## 常见问题排查

### ❌ agent_say 工具不存在

**症状：** agent 日志中找不到 agent_say 工具

**原因：** `tools.allow` 被 `stripPluginOnlyAllowlist` 删掉了

**修复：** 确保 `tools.allow = ["*", "group:plugins"]`（必须有 `"*"`）

### ❌ 飞书报 invalid param (10003)

**原因：** `app_id` 或 `app_secret` 不正确

**修复：**
1. 在飞书开放平台确认 App ID 和 App Secret
2. 确认 API 参数名是 snake_case（`app_id` 不是 `appId`，`app_secret` 不是 `appSecret`）

### ❌ 飞书报 Bot/User can NOT be out of the chat

**原因：** 机器人不在目标群聊中

**修复：** 将机器人重新拉入群聊

### ❌ agent 直接写文本回复而不是用 agent_say

**原因：** AGENTS.md 的回复协议不够明确

**修复：** 在 AGENTS.md 中明确写"绝对不允许直接输出文本回复"，并列出禁止事项

### ❌ 消息循环（同一消息无限重复）

**原因：** agent 收到注入消息后用 sessions_send 回复，形成循环

**修复：** 在 AGENTS.md 中添加防循环规则，明确禁止用 sessions_send 回复注入消息

### ❌ sessions_send 报错

**原因：** 缺少必要的配置

**修复：** 确保同时开启：
```json
{
  "tools": {
    "sessions": { "visibility": "all" },
    "agentToAgent": { "enabled": true }
  }
}
```

### ❌ 插件代码改动不生效

**原因：** gateway 没有重新加载插件代码

**修复：** 完全重启 gateway（`pkill openclaw-gateway && openclaw gateway start`），不要用 SIGUSR1 热重载

---

## 关键注意事项总结

| 注意事项 | 说明 |
|---------|------|
| `tools.allow` 必须包含 `"*"` | 防止 `stripPluginOnlyAllowlist` 删除插件工具 |
| 飞书 API 参数是 snake_case | `app_id`、`app_secret`，不是 camelCase |
| AGENTS.md 必须明确禁止直接文本回复 | LLM 可能误解"使用 agent_say"的含义 |
| SOUL.md 只放人设，不放行为协议 | 行为规范（回复协议、防循环）统一放 AGENTS.md |
| 每个 agent 独立的工作区 | 包含各自的 SOUL.md、AGENTS.md、TOOLS.md |
| 每个 agent 独立的飞书应用 | 不同的 App ID 和 App Secret |
| 不要用 `tools.profile` | 会过滤掉所有插件工具 |
| 插件代码改动需要完全重启 | SIGUSR1 不会重新加载插件 |
