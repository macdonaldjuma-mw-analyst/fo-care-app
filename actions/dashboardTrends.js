const db = require('../db');
const { requireAnyRole } = require('./admin');

const SCHEMA = '"FO_CARE_APP"';

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Daily created / resolved counts plus end-of-day backlog (open workload:
 * created on or before that day, not yet closed by end of that day) — for
 * the ticket-volume trend chart. Same org-wide scope as
 * getDashboardSummary: no category restriction, gated only by
 * requireAnyRole (any resolver/manager/admin/call center agent).
 *
 * Note: the backlog figure is a correlated subquery per day (scans the
 * tickets table once per day in the range). Fine at current volume; if
 * this gets slow as the ticket table grows, add indexes on
 * tickets(created_at) and tickets(closed_at), or precompute backlog with a
 * window function instead.
 */
async function getTicketTrend(payload) {
  await requireAnyRole(payload.email);
  const days = clampInt(payload.days, 30, 1, 180);

  const { rows } = await db.query(
    `SELECT
      to_char(d, 'YYYY-MM-DD') AS day,
      COALESCE(created.cnt, 0) AS created,
      COALESCE(resolved.cnt, 0) AS resolved,
      (
        SELECT COUNT(*) FROM ${SCHEMA}.tickets t
        WHERE t.created_at::date <= d
          AND (t.closed_at IS NULL OR t.closed_at::date > d)
      ) AS backlog
    FROM generate_series(
      date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
      date_trunc('day', now()),
      interval '1 day'
    ) AS d
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS cnt
      FROM ${SCHEMA}.tickets GROUP BY created_at::date
    ) created ON created.day = d::date
    LEFT JOIN (
      SELECT resolved_at::date AS day, COUNT(*) AS cnt
      FROM ${SCHEMA}.tickets WHERE resolved_at IS NOT NULL GROUP BY resolved_at::date
    ) resolved ON resolved.day = d::date
    ORDER BY d`,
    [days]
  );

  return {
    success: true,
    data: {
      trend: rows.map((row) => ({
        date: row.day,
        created: Number(row.created),
        resolved: Number(row.resolved),
        backlog: Number(row.backlog),
      })),
    },
  };
}

/**
 * Weekly SLA compliance: of tickets resolved in a given week (only ones
 * with both resolved_at and sla_due_at set), what % were resolved at or
 * before their SLA due time. A week with no resolutions comes back with
 * pct_on_time: null — the frontend should show a gap, not a misleading 0%.
 */
async function getSlaTrend(payload) {
  await requireAnyRole(payload.email);
  const weeks = clampInt(payload.weeks, 13, 1, 52);

  const { rows } = await db.query(
    `SELECT
      to_char(w, 'YYYY-MM-DD') AS week_start,
      COUNT(t.id) AS resolved_count,
      COUNT(*) FILTER (WHERE t.resolved_at <= t.sla_due_at) AS on_time_count
    FROM generate_series(
      date_trunc('week', now()) - ($1::int - 1) * interval '1 week',
      date_trunc('week', now()),
      interval '1 week'
    ) AS w
    LEFT JOIN ${SCHEMA}.tickets t
      ON t.resolved_at IS NOT NULL
      AND t.sla_due_at IS NOT NULL
      AND date_trunc('week', t.resolved_at) = w
    GROUP BY w
    ORDER BY w`,
    [weeks]
  );

  return {
    success: true,
    data: {
      weeks: rows.map((row) => {
        const resolvedCount = Number(row.resolved_count);
        const onTimeCount = Number(row.on_time_count);
        return {
          week_start: row.week_start,
          resolved_count: resolvedCount,
          pct_on_time: resolvedCount > 0 ? Number(((onTimeCount / resolvedCount) * 100).toFixed(1)) : null,
        };
      }),
    },
  };
}

/**
 * Current vs. prior-period ticket counts per category, for the trend
 * arrows on the category breakdown. Both windows are period_days long and
 * back-to-back — the prior window ends exactly where the current one
 * starts, so nothing is double-counted or skipped between them.
 */
async function getCategoryDeltas(payload) {
  await requireAnyRole(payload.email);
  const periodDays = clampInt(payload.period_days, 30, 1, 90);

  const { rows } = await db.query(
    `SELECT
      c.label AS category_label,
      COUNT(*) FILTER (
        WHERE t.created_at >= now() - (interval '1 day' * $1::int)
      ) AS count,
      COUNT(*) FILTER (
        WHERE t.created_at >= now() - (interval '1 day' * $1::int * 2)
          AND t.created_at < now() - (interval '1 day' * $1::int)
      ) AS prior_count
    FROM ${SCHEMA}.ticket_categories c
    LEFT JOIN ${SCHEMA}.tickets t ON t.category_id = c.id
    WHERE c.is_active = true
    GROUP BY c.label
    ORDER BY count DESC`,
    [periodDays]
  );

  return {
    success: true,
    data: {
      categories: rows.map((row) => ({
        category_label: row.category_label,
        count: Number(row.count),
        prior_count: Number(row.prior_count),
      })),
    },
  };
}

/**
 * Ticket creation counts bucketed by day-of-week (0=Sunday..6=Saturday,
 * matching JS Date#getDay()) and hour-of-day, over the trailing 180 days —
 * a staffing-pattern view. Combinations with no tickets ever created then
 * are filled in as 0 so the frontend always gets a full 7x24 grid.
 */
async function getCreationHeatmap(payload) {
  await requireAnyRole(payload.email);

  const { rows } = await db.query(
    `SELECT
      EXTRACT(DOW FROM t.created_at)::int AS day_of_week,
      EXTRACT(HOUR FROM t.created_at)::int AS hour,
      COUNT(*) AS count
    FROM ${SCHEMA}.tickets t
    WHERE t.created_at >= now() - interval '180 days'
    GROUP BY 1, 2`
  );

  const grid = new Map();
  rows.forEach((row) => {
    grid.set(`${row.day_of_week}-${row.hour}`, Number(row.count));
  });

  const heatmap = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      heatmap.push({ day_of_week: dow, hour, count: grid.get(`${dow}-${hour}`) || 0 });
    }
  }

  return { success: true, data: { heatmap } };
}

module.exports = {
  getTicketTrend,
  getSlaTrend,
  getCategoryDeltas,
  getCreationHeatmap,
};