// SLA rules for the first human response. Times are hours from creation.
export const TICKET_SLA_HOURS = { high: 4, medium: 24, low: 72 } as const;
export const DISPUTE_SLA_HOURS = { safety: 4, default: 24 } as const;
export const ESCALATED_SLA_HOURS = 4;

export type SlaStatus = "on_track" | "at_risk" | "breached" | "met";

export function dueAt(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * 3_600_000);
}

/**
 * SLA state of the FIRST RESPONSE: "met" once support has replied on time, "breached" if late or overdue,
 * "at_risk" in the last 25% of the window. Resolved/closed items with no reply are reported as "met".
 */
export function slaInfo(row: { sla_due_at?: any; first_response_at?: any; created_at: any }, done = false) {
  const due = row.sla_due_at ? new Date(row.sla_due_at) : null;
  if (!due) return { slaDueAt: null, slaStatus: "on_track" as SlaStatus, slaRemainingMinutes: null as number | null };
  const responded = row.first_response_at ? new Date(row.first_response_at) : null;
  const created = new Date(row.created_at).getTime();
  let status: SlaStatus;
  if (responded) status = responded <= due ? "met" : "breached";
  else if (done) status = "met";
  else {
    const now = Date.now();
    const window = due.getTime() - created;
    status = now > due.getTime() ? "breached" : due.getTime() - now < window * 0.25 ? "at_risk" : "on_track";
  }
  const remaining = responded || done ? null : Math.round((due.getTime() - Date.now()) / 60_000);
  return { slaDueAt: due, slaStatus: status, slaRemainingMinutes: remaining };
}
