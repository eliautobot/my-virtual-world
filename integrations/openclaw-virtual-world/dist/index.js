import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const configSchema = Type.Object({
    baseUrl: Type.Optional(Type.String({ description: "Optional fixed My Virtual World HTTP origin. By default the active world is resolved from the shared Live ownership registry." })),
    requestTimeoutMs: Type.Optional(Type.Number({ minimum: 1000, maximum: 120000 })),
});
function stableWorldToken(worldId) {
    return String(worldId || "")
        .replace(/[^A-Za-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}
function worldRegistryPath() {
    const explicit = String(process.env.VW_LIVE_AGENT_WORLD_REGISTRY_FILE || "").trim();
    if (explicit)
        return explicit;
    const openClawHome = String(process.env.OPENCLAW_HOME || join(homedir(), ".openclaw")).trim();
    return join(openClawHome, "workspace", "uploads", ".runtime", "live-agent-worlds.json");
}
function claimedWorldBinding(context) {
    const agentId = String(context.agentId || "").trim();
    const sessionKey = String(context.sessionKey || "").trim();
    if (!agentId || !sessionKey)
        return { baseUrl: "", bridgeSecret: "" };
    try {
        const registry = JSON.parse(readFileSync(worldRegistryPath(), "utf8"));
        const claim = registry?.agents?.[agentId];
        const worldToken = stableWorldToken(claim?.worldId);
        const port = String(claim?.port || "").trim();
        if (!worldToken || !/^\d{2,5}$/.test(port))
            return { baseUrl: "", bridgeSecret: "" };
        if (!sessionKey.endsWith(`:vw-live-world-${worldToken}`))
            return { baseUrl: "", bridgeSecret: "" };
        const numericPort = Number(port);
        if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535)
            return { baseUrl: "", bridgeSecret: "" };
        const bridgeSecret = String(registry?.worlds?.[claim?.worldId]?.bridgeAuth?.secret || "").trim();
        return {
            baseUrl: `http://127.0.0.1:${numericPort}`,
            bridgeSecret: bridgeSecret.length >= 32 ? bridgeSecret : "",
        };
    }
    catch {
        return { baseUrl: "", bridgeSecret: "" };
    }
}
function normalizedBaseUrl(config, binding) {
    return String(config.baseUrl
        || process.env.VW_ORIGIN
        || binding.baseUrl
        || "http://127.0.0.1:8590").replace(/\/+$/, "");
}
async function invokeWorld(config, context, tool, params, signal) {
    const agentId = String(context.agentId || "").trim();
    const sessionKey = String(context.sessionKey || "").trim();
    if (!agentId || !sessionKey) {
        throw new Error("My Virtual World tools require a bound OpenClaw agent and session.");
    }
    const timeoutMs = Math.max(1000, Math.min(120000, Number(config.requestTimeoutMs || 45000)));
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new Error("Virtual World request timed out.")), timeoutMs);
    const abort = () => timeoutController.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
        const binding = claimedWorldBinding(context);
        const body = JSON.stringify({ agentId, sessionKey, tool, params });
        const headers = {
            "Content-Type": "application/json",
            "X-VW-Agent-ID": agentId,
            "X-VW-Session-Key": sessionKey,
        };
        if (binding.bridgeSecret) {
            const timestamp = String(Math.floor(Date.now() / 1000));
            const nonce = randomBytes(18).toString("hex");
            const bodyDigest = createHash("sha256").update(body, "utf8").digest("hex");
            const signed = `${timestamp}\n${nonce}\n${bodyDigest}`;
            headers["X-VW-Bridge-Timestamp"] = timestamp;
            headers["X-VW-Bridge-Nonce"] = nonce;
            headers["X-VW-Bridge-Signature"] = createHmac("sha256", binding.bridgeSecret).update(signed, "utf8").digest("hex");
        }
        const response = await fetch(`${normalizedBaseUrl(config, binding)}/api/agent-live-tools/invoke`, {
            method: "POST",
            headers,
            body,
            signal: timeoutController.signal,
        });
        const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
        if (!response.ok || !payload || payload.ok === false) {
            const message = payload?.error?.message || payload?.error || `Virtual World request failed with HTTP ${response.status}`;
            throw new Error(String(message));
        }
        return payload;
    }
    finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
    }
}
function boundTool(tool, definition) {
    return tool({
        name: definition.name,
        label: definition.label,
        description: definition.description,
        parameters: definition.parameters,
        factory({ config, toolContext }) {
            return {
                name: definition.name,
                label: definition.label,
                description: definition.description,
                parameters: definition.parameters,
                async execute(_toolCallId, params, _onUpdate, runContext) {
                    const result = await invokeWorld(config, toolContext, definition.worldTool, params || {}, runContext?.signal);
                    return {
                        content: [{ type: "text", text: JSON.stringify(result) }],
                        details: result,
                    };
                },
            };
        },
    });
}
export default defineToolPlugin({
    id: "my-virtual-world",
    name: "My Virtual World",
    description: "Native embodiment, perception, memory, and action tools for Live Agent Mode.",
    configSchema,
    tools: (tool) => [
        boundTool(tool, {
            name: "virtual_world_observe",
            label: "Observe Virtual World",
            description: "Observe your authoritative body, location, inventory, active action, Resident Profile, commitments, nearby world state, and relevant My Virtual World memories.",
            parameters: Type.Object({ detail: Type.Optional(Type.Boolean()) }),
            worldTool: "observe",
        }),
        boundTool(tool, {
            name: "virtual_world_list_affordances",
            label: "List Virtual World Affordances",
            description: "List a bounded page of currently validated actions your embodied resident can perform. Filter by category when possible, then use a returned actionId with virtual_world_act.",
            parameters: Type.Object({
                category: Type.Optional(Type.String({ maxLength: 120 })),
                limit: Type.Optional(Type.Number({ minimum: 1, maximum: 40 })),
            }),
            worldTool: "list_affordances",
        }),
        boundTool(tool, {
            name: "virtual_world_act",
            label: "Act in Virtual World",
            description: "Start exactly one validated, visible physical action using a current actionId from virtual_world_list_affordances. The existing Virtual World action engine owns routing, reservation, animation, and verification.",
            parameters: Type.Object({
                actionId: Type.String({ minLength: 1, maxLength: 160 }),
                reason: Type.Optional(Type.String({ maxLength: 700 })),
                successCriteria: Type.Optional(Type.String({ maxLength: 700 })),
            }),
            worldTool: "act",
        }),
        boundTool(tool, {
            name: "virtual_world_inspect_action",
            label: "Inspect Virtual World Action",
            description: "Inspect authoritative progress or terminal evidence for your current or specified world action before replanning or claiming success.",
            parameters: Type.Object({ actionId: Type.Optional(Type.String({ maxLength: 200 })) }),
            worldTool: "inspect_action",
        }),
        boundTool(tool, {
            name: "virtual_world_cancel_action",
            label: "Cancel Virtual World Action",
            description: "Cancel your current physical action when you deliberately abandon it or user authority requires it.",
            parameters: Type.Object({
                actionId: Type.Optional(Type.String({ maxLength: 200 })),
                reason: Type.Optional(Type.String({ maxLength: 500 })),
            }),
            worldTool: "cancel_action",
        }),
        boundTool(tool, {
            name: "virtual_world_wait",
            label: "Wait in Virtual World",
            description: "Deliberately wait, observe, dwell, or remain in conversation without manufacturing another physical action.",
            parameters: Type.Object({
                seconds: Type.Optional(Type.Number({ minimum: 5, maximum: 300 })),
                reason: Type.String({ minLength: 1, maxLength: 700 }),
                wakeConditions: Type.Optional(Type.Array(Type.String({ maxLength: 220 }), { maxItems: 8 })),
            }),
            worldTool: "wait",
        }),
        boundTool(tool, {
            name: "virtual_world_recall",
            label: "Recall Virtual World Memory",
            description: "Retrieve relevant short-term and long-term memories maintained by My Virtual World for this embodied resident.",
            parameters: Type.Object({
                query: Type.Optional(Type.String({ maxLength: 700 })),
                limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
            }),
            worldTool: "recall",
        }),
        boundTool(tool, {
            name: "virtual_world_remember",
            label: "Remember Virtual World Experience",
            description: "Ask the My Virtual World memory manager to retain an evidence-grounded lesson, discovery, promise, or relationship fact from this embodied life.",
            parameters: Type.Object({
                text: Type.String({ minLength: 1, maxLength: 1200 }),
                importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
            }),
            worldTool: "remember",
        }),
        boundTool(tool, {
            name: "virtual_world_commit",
            label: "Update Virtual World Commitment",
            description: "Create, continue, complete, abandon, or block your current in-world commitment. This updates the existing Virtual World goal/controller state rather than creating a separate planner.",
            parameters: Type.Object({
                goal: Type.String({ minLength: 1, maxLength: 700 }),
                nextStep: Type.Optional(Type.String({ maxLength: 700 })),
                status: Type.Optional(Type.Union([
                    Type.Literal("active"),
                    Type.Literal("completed"),
                    Type.Literal("blocked"),
                    Type.Literal("abandoned"),
                ])),
            }),
            worldTool: "commit",
        }),
        boundTool(tool, {
            name: "virtual_world_say",
            label: "Speak in Virtual World",
            description: "Speak naturally as yourself in the My Virtual World Live Agent activity/conversation feed. World lifecycle messages are system events; only this tool and direct conversation create your speech.",
            parameters: Type.Object({ message: Type.String({ minLength: 1, maxLength: 1200 }) }),
            worldTool: "say",
        }),
    ],
});
