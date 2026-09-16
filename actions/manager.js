const db = require('../db');
const { AuthorizationError } = require('./admin');

const SCHEMA = '"FO_CARE_APP"';

async function requireManager(callerEmail) {
  if (!callerEmail) {
    throw new AuthorizationError('Not authorized as a manager.');
  }
  const { rows } = await db.query(
    `SELECT email FROM ${SCHEMA}.managers WHERE email = $1 AND is_active = true`,
    [callerEmail]
  );
  if (rows.length === 0) {
    throw new AuthorizationError('Not authorized as a manager.');
  }
}

async function getDashboardSummary(payload) {
  await requireManager(payload.email);

  const { rows } = await db.query(
    `SELECT
      c.id AS category_id, c.label AS category_label,
      COUNT(*) FILTER (WHERE t.status_code = 'OPEN') AS open,
      COUNT(*) FILTER (WHERE t.status_code = 'IN_PROGRESS') AS in_progress,
      COUNT(*) FILTER (WHERE t.status_code = 'RESOLVED_PENDING_CONFIRMATION') AS resolved_pending,
      COUNT(*) FILTER (WHERE t.sla_due_at IS NOT NULL AND now() > t.sla_due_at AND t.status_code IN ('OPEN', 'IN_PROGRESS', 'REOPENED')) AS overdue,
      COUNT(*) FILTER (WHERE t.sla_due_at IS NOT NULL AND now() > t.sla_due_at + interval '24 hours' AND t.status_code IN ('OPEN', 'IN_PROGRESS', 'REOPENED')) AS critical_overdue
    FROM ${SCHEMA}.ticket_categories c
    LEFT JOIN ${SCHEMA}.tickets t ON t.category_id = c.id
    LEFT JOIN ${SCHEMA}.ticket_statuses s ON s.code = t.status_code
    WHERE c.is_active = true
    GROUP BY c.id, c.label
    ORDER BY c.sort_order`
  );

  const categories = rows.map((row) => ({
    category_id: Number(row.category_id),
    category_label: row.category_label,
    open: Number(row.open),
    in_progress: Number(row.in_progress),
    resolved_pending: Number(row.resolved_pending),
    overdue: Number(row.overdue),
    critical_overdue: Number(row.critical_overdue),
  }));

  const totals = categories.reduce(
    (acc, c) => {
      acc.open += c.open;
      acc.in_progress += c.in_progress;
      acc.resolved_pending += c.resolved_pending;
      acc.overdue += c.overdue;
      acc.critical_overdue += c.critical_overdue;
      return acc;
    },
    { open: 0, in_progress: 0, resolved_pending: 0, overdue: 0, critical_overdue: 0 }
  );

  const total_tickets = totals.open + totals.in_progress + totals.resolved_pending;

  return {
    success: true,
    data: {
      summary: { total_tickets, ...totals },
      categories,
    },
  };
}

async function getSlaBreaches(payload) {
  await requireManager(payload.email);

  const { rows } = await db.query(
    `SELECT
      t.id, t.ticket_number, c.label AS category_label, t.status_code, s.label AS status_label,
      t.site_name, t.fo_email, t.assigned_resolver_email, t.sla_due_at, t.created_at,
      EXTRACT(EPOCH FROM (now() - t.sla_due_at)) / 3600 AS hours_overdue
    FROM ${SCHEMA}.tickets t
    JOIN ${SCHEMA}.ticket_categories c ON c.id = t.category_id
    JOIN ${SCHEMA}.ticket_statuses s ON s.code = t.status_code
    WHERE t.sla_due_at IS NOT NULL AND now() > t.sla_due_at AND t.status_code IN ('OPEN', 'IN_PROGRESS', 'REOPENED')
    ORDER BY t.sla_due_at ASC
    LIMIT 10`
  );

  const tickets = rows.map((row) => ({
    id: Number(row.id),
    ticket_number: row.ticket_number,
    category_label: row.category_label,
    status_code: row.status_code,
    status_label: row.status_label,
    site_name: row.site_name,
    fo_email: row.fo_email,
    assigned_resolver_email: row.assigned_resolver_email,
    sla_due_at: row.sla_due_at,
    created_at: row.created_at,
    hours_overdue: Number(Number(row.hours_overdue).toFixed(1)),
  }));

  const total_breaches = tickets.length;
  const critical_breaches = tickets.filter((t) => t.hours_overdue >= 24).length;
  const average_hours_overdue =
    total_breaches > 0
      ? Number((tickets.reduce((sum, t) => sum + t.hours_overdue, 0) / total_breaches).toFixed(1))
      : 0;

  return {
    success: true,
    data: {
      summary: { total_breaches, critical_breaches, average_hours_overdue },
      tickets,
    },
  };
}

async function getResolverPerformance(payload) {
  await requireManager(payload.email);
  const dateFrom = payload.date_from ?? null;
  const dateTo = payload.date_to ?? null;

  const { rows } = await db.query(
    `WITH date_range AS (
      SELECT
        COALESCE($1::timestamptz, now() - INTERVAL '30 days') AS date_from,
        COALESCE($2::timestamptz, now()) AS date_to
    )
    SELECT
      r.email AS resolver_email,
      r.name AS resolver_name,
      COUNT(*) FILTER (
        WHERE t.status_code IN ('CLOSED', 'CLOSED_AUTO')
          AND t.closed_at BETWEEN date_range.date_from AND date_range.date_to
      ) AS tickets_resolved,
      AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600) FILTER (
        WHERE t.resolved_at BETWEEN date_range.date_from AND date_range.date_to
      ) AS avg_resolution_hours,
      COUNT(*) FILTER (WHERE t.status_code IN ('OPEN', 'IN_PROGRESS')) AS currently_open,
      COUNT(*) FILTER (
        WHERE t.sla_due_at IS NOT NULL AND now() > t.sla_due_at AND t.status_code IN ('OPEN', 'IN_PROGRESS', 'REOPENED')
      ) AS currently_overdue
    FROM ${SCHEMA}.resolvers r
    LEFT JOIN ${SCHEMA}.tickets t ON t.assigned_resolver_email = r.email
    LEFT JOIN ${SCHEMA}.ticket_statuses s ON s.code = t.status_code
    CROSS JOIN date_range
    WHERE r.is_active = true
      -- Excludes anyone who is also a manager, matching n8n exactly.
      AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.managers m WHERE m.email = r.email)
    GROUP BY r.email, r.name
    ORDER BY r.name`,
    [dateFrom, dateTo]
  );

  const resolvers = rows.map((row) => ({
    resolver_email: row.resolver_email,
    resolver_name: row.resolver_name,
    tickets_resolved: Number(row.tickets_resolved || 0),
    avg_resolution_hours: row.avg_resolution_hours === null ? 0 : Number(Number(row.avg_resolution_hours).toFixed(1)),
    currently_open: Number(row.currently_open || 0),
    currently_overdue: Number(row.currently_overdue || 0),
  }));

  const summary = resolvers.reduce(
    (acc, r) => {
      acc.total_resolvers += 1;
      acc.tickets_resolved += r.tickets_resolved;
      acc.currently_open += r.currently_open;
      acc.currently_overdue += r.currently_overdue;
      return acc;
    },
    { total_resolvers: 0, tickets_resolved: 0, currently_open: 0, currently_overdue: 0 }
  );

  const resolutionHours = resolvers.filter((r) => r.avg_resolution_hours > 0).map((r) => r.avg_resolution_hours);
  summary.average_resolution_hours =
    resolutionHours.length > 0
      ? Number((resolutionHours.reduce((s, v) => s + v, 0) / resolutionHours.length).toFixed(1))
      : 0;

  return { success: true, data: { summary, resolvers } };
}

/**
 * FIXED per your decision: n8n's version went straight from the Postgres
 * node to Respond-to-Webhook with no row-aggregation Code node, which very
 * likely meant only the first matching ticket was ever actually returned —
 * while the frontend's downloadCsv() explicitly expects the full array.
 * This version returns every matching row.
 */
async function exportTicketHistory(payload) {
  await requireManager(payload.email);
  const dateFrom = payload.date_from ?? null;
  const dateTo = payload.date_to ?? null;

  const { rows } = await db.query(
    `SELECT
      t.ticket_number, c.label AS category_label, t.status_code, t.site_name,
      t.fo_email, t.farmer_account, t.farmer_name, t.assigned_resolver_email,
      t.created_at, t.resolved_at, t.closed_at, t.closed_reason
    FROM ${SCHEMA}.tickets t
    JOIN ${SCHEMA}.ticket_categories c ON c.id = t.category_id
    WHERE t.created_at BETWEEN
      COALESCE($1::timestamptz, now() - INTERVAL '30 days')
      AND COALESCE($2::timestamptz, now())
    ORDER BY t.created_at DESC`,
    [dateFrom, dateTo]
  );

  return { success: true, data: rows };
}

module.exports = {
  requireManager,
  getDashboardSummary,
  getSlaBreaches,
  getResolverPerformance,
  exportTicketHistory,
};