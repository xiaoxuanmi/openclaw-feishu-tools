import type { TokenCache } from "./types.js";

const TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const MSG_CREATE_URL = "https://open.feishu.cn/open-apis/im/v1/messages";

// ── Token cache (module-level, survives across tool calls) ──────────────
const tokenCache = new Map<string, TokenCache>();

/**
 * Get a valid Feishu tenant_access_token, refreshing if expired.
 * Caches per (appId, appSecret) pair.
 */
export async function getFeishuToken(appId: string, appSecret: string): Promise<string> {
  const cacheKey = appId;
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  const rawText = await res.text();
  console.log(`[agent-say] Feishu token request: app_id=${appId}, status=${res.status}, response=${rawText}`);

  let data: {
    code: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`Feishu token error: non-JSON response (${res.status}): ${rawText.slice(0, 200)}`);
  }

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Feishu token error: code=${data.code}, msg=${data.msg ?? 'unknown'}`);
  }

  const ttlMs = (data.expire ?? 7200) * 1000;
  tokenCache.set(cacheKey, {
    token: data.tenant_access_token,
    expiresAt: now + ttlMs,
  });

  return data.tenant_access_token;
}

/**
 * Send a message to a Feishu group chat.
 * Uses rich text (post) with @all so all bots in the group get notified.
 */
export async function sendFeishuMessage(opts: {
  appId: string;
  appSecret: string;
  chatId: string;
  text: string;
  mentionAll?: boolean;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { appId, appSecret, chatId, text, mentionAll } = opts;

  try {
    const token = await getFeishuToken(appId, appSecret);

    let body: Record<string, string>;
    if (mentionAll) {
      const postContent = {
        zh_cn: {
          title: "",
          content: [
            [
              { tag: "at", user_id: "all" },
              { tag: "text", text: ` ${text}` },
            ],
          ],
        },
      };
      body = {
        receive_id: chatId,
        content: JSON.stringify(postContent),
        msg_type: "post",
      };
    } else {
      body = {
        receive_id: chatId,
        content: JSON.stringify({ text }),
        msg_type: "text",
      };
    }

    const url = `${MSG_CREATE_URL}?receive_id_type=chat_id`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as {
      code: number;
      msg?: string;
      data?: { message_id?: string };
    };

    if (data.code !== 0) {
      // If token expired, retry once
      if (data.code === 99991663 || data.code === 99991668) {
        tokenCache.delete(appId);
        return sendFeishuMessage(opts);
      }
      return { ok: false, error: `Feishu API error: ${data.msg ?? `code ${data.code}`}` };
    }

    return { ok: true, messageId: data.data?.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
