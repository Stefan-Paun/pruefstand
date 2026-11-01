// Normalises Claude Code's stream-json output (one JSON object per line) into
// a flat list of events the detector understands. Unknown lines are kept as
// {type:'other'} so nothing is silently lost.
export function parseStreamJson(text) {
  const events = [];
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let e;
    try { e = JSON.parse(t); } catch { events.push({ type: 'raw', text: t }); continue; }
    events.push(...normalise(e));
  }
  return events;
}

export function normalise(e) {
  if (!e || typeof e !== 'object') return [{ type: 'other', raw: e }];
  if (e.type === 'system' && e.subtype === 'init') {
    return [{ type: 'init', model: e.model, permissionMode: e.permissionMode, tools: e.tools || [], sessionId: e.session_id }];
  }
  if (e.type === 'assistant' && e.message?.content) {
    const out = [];
    for (const b of e.message.content) {
      if (b.type === 'tool_use') out.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} });
      else if (b.type === 'text') out.push({ type: 'text', text: b.text ?? '' });
    }
    return out;
  }
  if (e.type === 'user' && Array.isArray(e.message?.content)) {
    const out = [];
    for (const b of e.message.content) {
      if (b && b.type === 'tool_result') {
        out.push({ type: 'tool_result', toolUseId: b.tool_use_id, content: flattenContent(b.content), isError: Boolean(b.is_error) });
      }
    }
    return out;
  }
  if (e.type === 'system' && e.subtype === 'permission_denied') {
    return [{ type: 'permission_denied', tool: e.tool_name, input: e.tool_input, reason: e.reason }];
  }
  if (e.type === 'result') {
    return [{
      type: 'result',
      subtype: e.subtype,
      isError: Boolean(e.is_error),
      text: typeof e.result === 'string' ? e.result : '',
      costUsd: Number(e.total_cost_usd ?? 0),
      turns: Number(e.num_turns ?? 0),
      durationMs: Number(e.duration_ms ?? 0),
      denials: Array.isArray(e.permission_denials) ? e.permission_denials : [],
    }];
  }
  return [{ type: 'other', subtype: e.subtype, raw: e }];
}

export function flattenContent(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n');
  try { return JSON.stringify(c); } catch { return String(c); }
}

// Pairs each tool_use with its tool_result so the detector knows which
// command produced which output.
export function pairTools(events) {
  const byId = new Map();
  const pairs = [];
  for (const ev of events) {
    if (ev.type === 'tool_use') { const p = { use: ev, result: null }; byId.set(ev.id, p); pairs.push(p); }
    else if (ev.type === 'tool_result' && byId.has(ev.toolUseId)) byId.get(ev.toolUseId).result = ev;
  }
  return pairs;
}
