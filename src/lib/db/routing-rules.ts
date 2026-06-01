import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type ConditionType =
  | "task_type"
  | "message_length"
  | "tool_required"
  | "persona_active"
  | "time_of_day"
  | "manual_override";

export type RoutingRule = {
  rule_id: string;
  sort_order: number;
  condition_type: ConditionType;
  condition_value: string | null;
  target_agent_name: string;
  enabled: number;
  created_at: number;
};

function readNow(): number {
  const r = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return r.t;
}

export function listRules(): RoutingRule[] {
  return getConfigDb()
    .prepare("SELECT * FROM agent_routing_rules ORDER BY sort_order, created_at")
    .all() as RoutingRule[];
}

export function getRule(id: string): RoutingRule | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM agent_routing_rules WHERE rule_id=?")
      .get(id) as RoutingRule | undefined) || null
  );
}

export function createRule(args: {
  condition_type: ConditionType;
  condition_value?: string | null;
  target_agent_name: string;
  sort_order?: number;
  enabled?: boolean;
}): RoutingRule {
  const id = `rule-${nanoid(10)}`;
  const order =
    args.sort_order ??
    ((getConfigDb().prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM agent_routing_rules").get() as { m: number }).m + 1);
  getConfigDb()
    .prepare(
      "INSERT INTO agent_routing_rules (rule_id, sort_order, condition_type, condition_value, target_agent_name, enabled, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(
      id,
      order,
      args.condition_type,
      args.condition_value ?? null,
      args.target_agent_name,
      args.enabled === false ? 0 : 1,
      readNow()
    );
  return getRule(id)!;
}

export function updateRule(
  id: string,
  patch: Partial<Pick<RoutingRule, "condition_type" | "condition_value" | "target_agent_name" | "sort_order" | "enabled">>
): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k}=@${k}`).join(", ");
  getConfigDb()
    .prepare(`UPDATE agent_routing_rules SET ${set} WHERE rule_id=@id`)
    .run({ ...patch, id } as Record<string, unknown>);
}

export function deleteRule(id: string): boolean {
  const r = getConfigDb().prepare("DELETE FROM agent_routing_rules WHERE rule_id=?").run(id);
  return r.changes > 0;
}

export function reorderRules(orderedIds: string[]): void {
  const db = getConfigDb();
  const tx = db.transaction(() => {
    orderedIds.forEach((id, i) => {
      db.prepare("UPDATE agent_routing_rules SET sort_order=? WHERE rule_id=?").run(i, id);
    });
  });
  tx();
}

/**
 * Evaluate the rules against a routing context. Returns the first matching
 * rule's target agent name, or null if no rule matched. Pure function — used
 * by both the API (`?evaluate=1`) and by the agent engine when multi-agent
 * routing is wired in.
 */
export type RoutingContext = {
  task_type?: string;          // 'code' | 'research' | 'writing' | 'analysis' | 'quick_lookup'
  message_length?: number;     // character count of the user message
  required_tools?: string[];   // tools the message likely needs
  active_persona?: string;     // persona id
  manual_override_agent?: string; // user typed @AgentName
};

export function evaluateRules(ctx: RoutingContext, rules: RoutingRule[] = listRules()): RoutingRule | null {
  if (ctx.manual_override_agent) {
    return {
      rule_id: "manual-override",
      sort_order: -1,
      condition_type: "manual_override",
      condition_value: ctx.manual_override_agent,
      target_agent_name: ctx.manual_override_agent,
      enabled: 1,
      created_at: 0,
    };
  }
  for (const rule of rules) {
    if (rule.enabled !== 1) continue;
    if (matchRule(rule, ctx)) return rule;
  }
  return null;
}

function matchRule(rule: RoutingRule, ctx: RoutingContext): boolean {
  const v = rule.condition_value;
  switch (rule.condition_type) {
    case "task_type":
      return !!ctx.task_type && !!v && v.split(",").map((s) => s.trim()).includes(ctx.task_type);
    case "message_length": {
      if (ctx.message_length == null || !v) return false;
      // condition_value formats: ">500", "<200", "100-1000"
      const range = v.match(/^(\d+)-(\d+)$/);
      if (range) {
        const [, lo, hi] = range;
        return ctx.message_length >= Number(lo) && ctx.message_length <= Number(hi);
      }
      const m = v.match(/^([<>]=?)(\d+)$/);
      if (!m) return Number(v) === ctx.message_length;
      const n = Number(m[2]);
      switch (m[1]) {
        case ">": return ctx.message_length > n;
        case ">=": return ctx.message_length >= n;
        case "<": return ctx.message_length < n;
        case "<=": return ctx.message_length <= n;
      }
      return false;
    }
    case "tool_required": {
      if (!v || !ctx.required_tools) return false;
      const need = v.split(",").map((s) => s.trim());
      return need.some((t) => ctx.required_tools!.includes(t));
    }
    case "persona_active":
      return !!ctx.active_persona && !!v && (v === ctx.active_persona || v === ctx.active_persona.replace(/^persona-/, ""));
    case "time_of_day": {
      if (!v) return false;
      // condition_value format: "9-17" (inclusive lo, exclusive hi) using local hours.
      const m = v.match(/^(\d{1,2})-(\d{1,2})$/);
      if (!m) return false;
      const h = new Date().getHours();
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      return h >= lo && h < hi;
    }
    case "manual_override":
      return false; // handled above
  }
}
