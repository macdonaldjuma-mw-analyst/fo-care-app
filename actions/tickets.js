const db = require('../db');

const SCHEMA = '"FO_CARE_APP"';

// Real transition map, confirmed from n8n's Update_status_If_check node.
// IN_PROGRESS can go back to OPEN (a resolver un-claiming a ticket) as well
// as forward to RESOLVED_PENDING_CONFIRMATION — this is NOT the same map I
// used in the very first (pre-verification) draft of this action.
const VALID_TRANSITIONS = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['RESOLVED_PENDING_CONFIRMATION', 'OPEN'],
  REOPENED: ['IN_PROGRESS'],
};

/**
 * Lists tickets visible to a resolver (scoped to their category access),
 * with the same optional filters as the n8n version: status, overdue-only,
 * "my tickets only", category, and free-text search across ticket number /
 * farmer name / farmer account.
 */
async function getTickets(payload) {
  const resolverEmail = payload.email;
  const status = payload.status ?? null;
  const overdueOnly = payload.overdue_only ?? null;
  const myTicketsOnly = payload.my_tickets_only ?? null;
  const categoryId = payload.category_id ?? null;
  const search = payload.search ?? null;

  const { rows } = await db.query(
    `SELECT
      t.id, t.ticket_number, c.label AS category_label, t.status_code, s.label AS status_label,
      t.description, t.farmer_account, t.farmer_name, t.site_id, t.site_name,
      t.fo_email, t.assigned_resolver_email, t.sla_due_at, t.created_at, t.updated_at,
      (t.sla_due_at IS NOT NULL AND now() > t.sla_due_at AND t.status_code IN ('OPEN', 'IN_PROGRESS', 'REOPENED')) AS is_overdue
    FROM ${SCHEMA}.tickets t
    JOIN ${SCHEMA}.ticket_categories c ON c.id = t.category_id
    JOIN ${SCHEMA}.ticket_statuses s ON s.code = t.status_code
    WHERE t.category_id IN (
        SELECT category_id FROM ${SCHEMA}.resolver_category_access WHERE resolver_email = $1
    )
    AND ($2::text IS NULL OR t.status_code = $2::text)
    AND (
        $3::boolean IS NULL
        OR (t.sla_due_at IS NOT NULL AND now() > t.sla_due_at AND t.status_code IN ('OPEN', 'IN_PROGRESS', 'REOPENED')) = $3::boolean
    )
    AND (
        $4::boolean IS NULL
        OR ($4::boolean = false OR t.assigned_resolver_email = $1)
    )
    AND ($5::int IS NULL OR t.category_id = $5::int)
    AND (
        $6::text IS NULL
        OR t.ticket_number ILIKE '%' || $6 || '%'
        OR t.farmer_name ILIKE '%' || $6 || '%'
        OR t.farmer_account ILIKE '%' || $6 || '%'
    )
    ORDER BY t.created_at DESC`,
    [resolverEmail, status, overdueOnly, myTicketsOnly, categoryId, search]
  );

  const tickets = rows.map((row) => ({
    id: row.id != null ? Number(row.id) : null,
    ticket_number: row.ticket_number ?? null,
    category_label: row.category_label ?? null,
    status_code: row.status_code ?? null,
    status_label: row.status_label ?? null,
    description: row.description ?? null,
    farmer_account: row.farmer_account ?? null,
    farmer_name: row.farmer_name ?? null,
    site_id: row.site_id != null ? Number(row.site_id) : null,
    site_name: row.site_name ?? null,
    fo_email: row.fo_email ?? null,
    assigned_resolver_email: row.assigned_resolver_email ?? null,
    sla_due_at: row.sla_due_at ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    is_overdue: Boolean(row.is_overdue),
  }));

  return { success: true, data: tickets };
}

/**
 * Full ticket detail: attachments, comments, and status history nested via
 * json_agg in the same query, exactly as n8n does it. Access is scoped to
 * the caller's category access — a resolver with no access to this
 * ticket's category gets "not found", same as n8n (never a bare 403).
 */
async function getTicketDetail(payload) {
  const { rows } = await db.query(
    `SELECT
      t.id, t.ticket_number, c.label AS category_label, t.status_code, s.label AS status_label,
      t.fo_email, t.fo_name, t.site_id, t.site_name, t.farmer_account, t.farmer_name,
      t.description, t.custom_fields, t.sla_due_at, t.assigned_resolver_email,
      t.resolver_name, t.resolved_at, t.confirmed_at, t.closed_at, t.closed_reason,
      t.created_at, t.updated_at,
      (t.sla_due_at IS NOT NULL AND now() > t.sla_due_at AND t.status_code IN ('OPEN', 'IN_PROGRESS', 'REOPENED')) AS is_overdue,
      COALESCE((SELECT json_agg(json_build_object('file_url', a.file_url, 'file_name', a.file_name,
          'uploaded_by_role', a.uploaded_by_role, 'uploaded_at', a.uploaded_at) ORDER BY a.uploaded_at)
        FROM ${SCHEMA}.ticket_attachments a WHERE a.ticket_id = t.id), '[]') AS attachments,
      COALESCE((SELECT json_agg(json_build_object('author_role', cm.author_role, 'author_name', cm.author_name,
          'comment_text', cm.comment_text, 'created_at', cm.created_at) ORDER BY cm.created_at)
        FROM ${SCHEMA}.ticket_comments cm WHERE cm.ticket_id = t.id), '[]') AS comments,
      COALESCE((SELECT json_agg(json_build_object('old_status', h.old_status, 'new_status', h.new_status,
          'changed_by_role', h.changed_by_role, 'changed_by', h.changed_by, 'note', h.note, 'changed_at', h.changed_at) ORDER BY h.changed_at)
        FROM ${SCHEMA}.ticket_status_history h WHERE h.ticket_id = t.id), '[]') AS status_history
    FROM ${SCHEMA}.tickets t
    JOIN ${SCHEMA}.ticket_categories c ON c.id = t.category_id
    JOIN ${SCHEMA}.ticket_statuses s ON s.code = t.status_code
    WHERE t.id = $1
      AND t.category_id IN (SELECT category_id FROM ${SCHEMA}.resolver_category_access WHERE resolver_email = $2)`,
    [payload.ticket_id, payload.email]
  );

  if (rows.length === 0 || rows[0].id == null) {
    return {
      success: false,
      error: 'Ticket not found or you do not have permission to view it.',
    };
  }

  const row = rows[0];
  let customFields = row.custom_fields;
  if (typeof customFields === 'string') {
    try {
      customFields = JSON.parse(customFields);
    } catch (e) {
      customFields = {};
    }
  }

  return {
    success: true,
    data: {
      id: Number(row.id),
      ticket_number: row.ticket_number ?? null,
      category_label: row.category_label ?? null,
      status_code: row.status_code ?? null,
      status_label: row.status_label ?? null,
      fo_email: row.fo_email ?? null,
      fo_name: row.fo_name ?? null,
      site_id: row.site_id != null ? Number(row.site_id) : null,
      site_name: row.site_name ?? null,
      farmer_account: row.farmer_account ?? null,
      farmer_name: row.farmer_name ?? null,
      description: row.description ?? null,
      custom_fields: customFields ?? {},
      sla_due_at: row.sla_due_at ?? null,
      assigned_resolver_email: row.assigned_resolver_email ?? null,
      resolver_name: row.resolver_name ?? null,
      resolved_at: row.resolved_at ?? null,
      confirmed_at: row.confirmed_at ?? null,
      closed_at: row.closed_at ?? null,
      closed_reason: row.closed_reason ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      is_overdue: Boolean(row.is_overdue),
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      comments: Array.isArray(row.comments) ? row.comments : [],
      status_history: Array.isArray(row.status_history) ? row.status_history : [],
    },
  };
}

/**
 * Adds a comment. Authorization is embedded in the INSERT itself (the
 * SELECT...WHERE clause) rather than a separate gate — matches n8n exactly.
 * Note: n8n's "Code in JavaScript33" ahead of this insert only added debug
 * fields (debug_comment_length/debug_comment) that nothing downstream
 * reads — dropped here as dead code, not a behavior change.
 */
async function addComment(payload) {
  const { rows } = await db.query(
    `INSERT INTO ${SCHEMA}.ticket_comments (ticket_id, author_role, author_name, author_email, comment_text)
     SELECT $1, 'resolver', r.name, $2, $3
     FROM ${SCHEMA}.resolvers r
     WHERE r.email = $2
       AND $1 IN (SELECT id FROM ${SCHEMA}.tickets WHERE category_id IN
         (SELECT category_id FROM ${SCHEMA}.resolver_category_access WHERE resolver_email = $2))
     RETURNING id, ticket_id, comment_text, created_at`,
    [payload.ticket_id, payload.email, payload.comment_text]
  );

  if (rows.length === 0) {
    return {
      success: false,
      error: 'Failed to add comment. Ticket not found or you do not have permission to comment on it.',
    };
  }

  const row = rows[0];
  return {
    success: true,
    data: {
      id: Number(row.id),
      ticket_id: Number(row.ticket_id),
      comment_text: row.comment_text ?? '',
      created_at: row.created_at ?? null,
    },
  };
}

/**
 * Updates ticket status. Two things preserved exactly from n8n:
 *  1. Moving to IN_PROGRESS also claims the ticket (assigned_resolver_email),
 *     with a concurrency guard so two resolvers can't both claim the same
 *     unassigned ticket.
 *  2. Access is scoped via the JOIN on resolver_category_access — a
 *     resolver with no access to this ticket's category can't move it.
 */
async function updateStatus(payload) {
  const ticketId = payload.ticket_id;
  const resolverEmail = payload.email;
  const newStatus = payload.new_status;

  const oldStatusRes = await db.query(
    `SELECT
        t.id,
        t.status_code AS old_status,
        r.name AS resolver_name
    FROM ${SCHEMA}.tickets t
    JOIN ${SCHEMA}.resolver_category_access rca
        ON rca.category_id = t.category_id
        AND rca.resolver_email = $2
    JOIN ${SCHEMA}.resolvers r
        ON r.email = $2
    WHERE t.id = $1`,
    [ticketId, resolverEmail]
  );

  if (oldStatusRes.rows.length === 0) {
    return { success: false, error: 'Failed to update ticket status or ticket not found.' };
  }

  const { old_status: oldStatus, resolver_name: resolverName } = oldStatusRes.rows[0];
  const allowed = VALID_TRANSITIONS[oldStatus] || [];
  if (!allowed.includes(newStatus)) {
    return { success: false, error: "That status change isn't allowed." };
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const updateRes = await client.query(
      `UPDATE ${SCHEMA}.tickets
       SET status_code = $2,
           resolved_at = CASE WHEN $2 = 'RESOLVED_PENDING_CONFIRMATION' THEN now() ELSE resolved_at END,
           resolver_name = CASE WHEN $2 = 'RESOLVED_PENDING_CONFIRMATION' THEN $3 ELSE resolver_name END,
           assigned_resolver_email = CASE WHEN $2 = 'IN_PROGRESS' THEN $4 ELSE assigned_resolver_email END
       WHERE id = $1
         AND ($2 != 'IN_PROGRESS' OR assigned_resolver_email IS NULL OR assigned_resolver_email = $4)
       RETURNING id, status_code, assigned_resolver_email`,
      [ticketId, newStatus, resolverName, resolverEmail]
    );

    if (updateRes.rows.length === 0) {
      // Someone else claimed it between the read and this write, or the row
      // otherwise no longer matches — same generic message n8n uses for both.
      await client.query('ROLLBACK');
      return { success: false, error: 'Failed to update ticket status or ticket not found.' };
    }

    await client.query(
      `INSERT INTO ${SCHEMA}.ticket_status_history (ticket_id, old_status, new_status, changed_by_role, changed_by)
       VALUES ($1, $2, $3, 'resolver', $4)`,
      [ticketId, oldStatus, newStatus, resolverEmail]
    );

    await client.query('COMMIT');

    const row = updateRes.rows[0];
    return {
      success: true,
      data: { id: Number(row.id), status_code: row.status_code },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Peer resolvers who share at least one category with the caller (used to
 * populate the reassignment dropdown) — excludes the caller themselves.
 */
async function getMyResolvers(payload) {
  const { rows } = await db.query(
    `SELECT DISTINCT r.email, r.name
     FROM ${SCHEMA}.resolvers r
     JOIN ${SCHEMA}.resolver_category_access rca ON rca.resolver_email = r.email
     WHERE r.is_active = true
       AND rca.category_id IN (SELECT category_id FROM ${SCHEMA}.resolver_category_access WHERE resolver_email = $1)
       AND r.email != $1
     ORDER BY r.name`,
    [payload.email]
  );

  return {
    success: true,
    data: rows.map((row) => ({ email: row.email ?? null, name: row.name ?? null })),
  };
}

module.exports = {
  getTickets,
  getTicketDetail,
  addComment,
  updateStatus,
  getMyResolvers,
};