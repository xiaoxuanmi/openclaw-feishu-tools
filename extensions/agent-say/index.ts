import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { AgentSayConfig } from "./src/types.js";
import { sendFeishuMessage } from "./src/feishu-client.js";
import { injectSessionMessage } from "./src/session-inject.js";

const TOOL_NAME = "agent-say";

function resolvePluginConfig(api: OpenClawPluginApi): AgentSayConfig {
  const raw = (api.config?.plugins?.entries as Record<string, unknown>)?.["agent-say"];
  if (raw && typeof raw === "object" && "config" in raw) {
    return ((raw as Record<string, unknown>).config ?? {}) as AgentSayConfig;
  }
  return {};
}

/**
 * Find the Feishu account that matches the given agentId.
 * Matches by appId/key in the accounts map, falls back to "default" account.
 */
function resolveFeishuCredentials(
  api: OpenClawPluginApi,
  agentId: string,
): { appId: string; appSecret: string; accountId: string } {
  const feishuCfg = api.config?.channels?.feishu as
    | Record<string, unknown>
    | undefined;

  if (!feishuCfg) {
    throw new Error("Feishu channel not configured in openclaw.json");
  }

  const accounts = feishuCfg.accounts as Record<string, Record<string, unknown>> | undefined;
  if (accounts) {
    // Primary: match agentId to account name (e.g., agent "rd" → account "rd")
    const account = accounts[agentId];
    if (account) {
      return {
        appId: String(account.appId ?? ""),
        appSecret: String(account.appSecret ?? ""),
        accountId: agentId,
      };
    }
    // Fallback: "default" account
    const def = accounts["default"];
    if (def) {
      return {
        appId: String(def.appId ?? ""),
        appSecret: String(def.appSecret ?? ""),
        accountId: "default",
      };
    }
    throw new Error(
      `No Feishu account found for agent "${agentId}". ` +
      `Available accounts: ${Object.keys(accounts).join(", ")}`,
    );
  }

  // Legacy flat config
  const appId = String(feishuCfg.appId ?? "");
  const appSecret = String(feishuCfg.appSecret ?? "");
  if (!appId || !appSecret) {
    throw new Error("Feishu appId/appSecret not found in config");
  }
  return { appId, appSecret, accountId: "legacy" };
}

/**
 * Get all agent IDs from the OpenClaw config (excluding the given agent).
 */
function getOtherAgentIds(api: OpenClawPluginApi, excludeId: string): string[] {
  const agents = api.config?.agents?.list as Array<{ id: string }> | undefined;
  if (!agents) return [];
  return agents.map((a) => a.id).filter((id) => id !== excludeId);
}

function resolveGatewayEndpoint(
  api: OpenClawPluginApi,
): { url: string; token: string } {
  const gw = api.config?.gateway as Record<string, unknown> | undefined;
  const port = Number(gw?.port ?? 18789);
  const bind = String(gw?.bind ?? "loopback");
  const auth = gw?.auth as Record<string, unknown> | undefined;
  const token = String(auth?.token ?? "");

  if (!token) {
    throw new Error("Gateway auth token not found in config");
  }

  const host = bind === "loopback" ? "127.0.0.1" : bind;
  return { url: `http://${host}:${port}`, token };
}

// ── Plugin entry ────────────────────────────────────────────────────────

export default function register(api: OpenClawPluginApi) {
  const pluginCfg = resolvePluginConfig(api);

  api.registerTool(
    {
      name: TOOL_NAME,
      label: "Agent Say",
      description:
        "Broadcast a message to the Feishu group chat and inject it into other agents' sessions. " +
        "Use this when you need to speak in a multi-agent group chat so humans and other agents see your message. " +
        "Required: message, chat_id (the Feishu group chat ID), agent_id (your own agent ID, e.g. 'rd' or 'pm'). " +
        "Optional: channel (default 'feishu'), targets (agent IDs to notify, default all other agents), sender (display name).",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message content to broadcast",
          },
          chat_id: {
            type: "string",
            description: "Feishu group chat ID (e.g., 'oc_xxx'). The agent knows its current chat context.",
          },
          agent_id: {
            type: "string",
            description:
              "Your own agent ID (e.g., 'rd', 'pm', 'main'). " +
              "Used to resolve your Feishu credentials for sending messages.",
          },
          channel: {
            type: "string",
            description: "Channel name for session key construction (default: 'feishu')",
          },
          targets: {
            type: "array",
            items: { type: "string" },
            description:
              "Target agent IDs to inject messages into. " +
              "Defaults to all other agents from agents.list config.",
          },
          sender: {
            type: "string",
            description:
              "Display name prefix (e.g., '研发小工 🔧'). Prepended as '[name]: message'.",
          },
        },
        required: ["message", "chat_id", "agent_id"],
      },
      async execute(_id, params) {
        const p = params as {
          message: string;
          chat_id: string;
          agent_id: string;
          channel?: string;
          targets?: string[];
          sender?: string;
        };

        const chatId = p.chat_id;
        const agentId = p.agent_id;
        const channel = p.channel ?? "feishu";
        const targetAgents =
          p.targets && p.targets.length > 0
            ? p.targets
            : getOtherAgentIds(api, agentId);

        // ── Format message with sender prefix ───────────────────────
        const text = p.sender ? `[${p.sender}]: ${p.message}` : p.message;

        // ── 1) Send to Feishu group chat ────────────────────────────
        // Resolve credentials by matching agentId → feishu account
        const { appId, appSecret, accountId } = resolveFeishuCredentials(api, agentId);
        const feishuResult = await sendFeishuMessage({
          appId,
          appSecret,
          chatId,
          text,
          mentionAll: true,
        });

        // ── 2) Inject into target agent sessions ────────────────────
        const sessionResults: Record<string, { ok: boolean; sessionKey?: string; error?: string }> = {};
        if (targetAgents.length > 0) {
          const { url: gwUrl, token: gwToken } = resolveGatewayEndpoint(api);
          const timeout = pluginCfg.timeoutSeconds ?? 0;

          for (const targetId of targetAgents) {
            // Session key pattern: agent:{targetId}:{channel}:group:{chatId}
            const sessionKey = `agent:${targetId}:${channel}:group:${chatId}`;
            // Source session: the calling agent's group session
            const sourceSessionKey = `agent:${agentId}:${channel}:group:${chatId}`;
            const result = await injectSessionMessage({
              gatewayUrl: gwUrl,
              gatewayToken: gwToken,
              sessionKey,
              message: text,
              timeoutSeconds: timeout,
              sourceSessionKey,
              sourceChannel: channel,
              sourceTool: TOOL_NAME,
            });
            sessionResults[targetId] = { ...result, sessionKey };
          }
        }

        // ── 3) Build result ─────────────────────────────────────────
        const summary = {
          feishu: { ...feishuResult, accountId },
          sessions: sessionResults,
          config: {
            chatId,
            channel,
            agentId,
            targets: targetAgents,
          },
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      },
    },
  );

  api.logger.info?.("agent-say: Registered agent-say tool");
}
