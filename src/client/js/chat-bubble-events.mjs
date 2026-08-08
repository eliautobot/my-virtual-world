/*
 * Provider-neutral ordering for compact in-world chat snapshots.
 *
 * The full chat owns explicit live chronology through ChatEvents. Yellow
 * bubbles receive a compact snapshot where thinking, tools and the current
 * reply can share one record, so the only safe order is activity before the
 * growing/final reply. Keep this helper DOM-free so browser and Node replay
 * tests exercise the same reconciliation rule.
 */

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function orderedSnapshotBubbleParts(message, { toolLimit = 3 } = {}) {
  if (!message || typeof message !== 'object') return [];
  const parts = [];
  const text = String(message.text ?? message.reply ?? message.content ?? '');
  const textKey = cleanText(text);
  const commentary = String(message.commentary ?? '');
  const commentaryKey = cleanText(commentary);
  const thinking = String(message.thinking ?? '');
  const thinkingKey = cleanText(thinking);

  if (commentaryKey && commentaryKey !== textKey) {
    parts.push({ kind: 'commentary', text: commentary });
  }
  if (thinkingKey && thinkingKey !== textKey && thinkingKey !== commentaryKey) {
    parts.push({ kind: 'thinking', text: thinking, reasoningTokens: message.reasoningTokens || 0 });
  } else if (!thinkingKey && message.reasoningTokens) {
    parts.push({ kind: 'thinking', text: '', reasoningTokens: message.reasoningTokens });
  }

  const tools = Array.isArray(message.tools) ? message.tools : [];
  const limit = Math.max(1, Number(toolLimit) || 3);
  const shown = tools.slice(-limit);
  for (const tool of shown) parts.push({ kind: 'tool', tool });
  if (tools.length > shown.length) {
    parts.push({ kind: 'tool-overflow', count: tools.length - shown.length });
  }

  if (message.approval && typeof message.approval === 'object') {
    parts.push({ kind: 'approval', approval: message.approval });
  }
  if (textKey) parts.push({ kind: 'text', text });
  return parts;
}
