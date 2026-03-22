/**
 * Inject a message into another agent's session via the gateway HTTP API.
 * Uses POST /tools/invoke with the sessions_send tool.
 *
 * The caller constructs the sessionKey using the pattern:
 *   agent:{targetAgentId}:{channel}:group:{chatId}
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
  const { gatewayUrl, gatewayToken, sessionKey, message, timeoutSeconds = 0, sourceSessionKey, sourceChannel, sourceTool } = opts;

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
      result?: { content?: Array<{ text?: string }>; status?: string; error?: string };
      error?: { message?: string };
    };

    if (!data.ok) {
      return { ok: false, error: data.error?.message ?? "Unknown gateway error" };
    }

    // Check the actual sessions_send result — HTTP ok doesn't mean the send succeeded
    const resultText = data.result?.content?.[0]?.text;
    if (resultText) {
      try {
        const inner = JSON.parse(resultText);
        if (inner.status && inner.status !== "ok" && inner.status !== "accepted") {
          return { ok: false, error: inner.error ?? `sessions_send status: ${inner.status}` };
        }
      } catch { /* not JSON, treat as success */ }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
