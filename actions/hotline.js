const db = require('../db');
const { AuthorizationError } = require('./admin');

const SCHEMA = '"FO_CARE_APP"';

/**
 * Mirrors n8n's Agent_Gate exactly: call_center_agents UNION admins — an
 * admin can also perform hotline actions. Error message ("Not authorized to
 * log tickets.") is verbatim from n8n's Prep_response nodes, even for the
 * read-only actions where the wording is a bit off — kept for parity.
 */
async function requireAgent(callerEmail) {
  if (!callerEmail) {
    throw new AuthorizationError('Not authorized to log tickets.');
  }
  const { rows } = await db.query(
    `SELECT email FROM ${SCHEMA}.call_center_agents WHERE email = $1 AND is_active = true
     UNION
     SELECT email FROM ${SCHEMA}.admins WHERE email = $1 AND is_active = true`,
    [callerEmail]
  );
  if (rows.length === 0) {
    throw new AuthorizationError('Not authorized to log tickets.');
  }
}

async function getTicketCategories(payload) {
  await requireAgent(payload.email);
  const { rows } = await db.query(
    `SELECT
      c.id, c.code, c.label, c.sla_hours,
      COALESCE(
        json_agg(
          json_build_object(
            'field_key', f.field_key, 'label', f.label, 'field_type', f.field_type,
            'is_required', f.is_required, 'options', f.options, 'sort_order', f.sort_order,
            'depends_on_field_key', f.depends_on_field_key, 'depends_on_value', f.depends_on_value,
            'options_source', f.options_source, 'filter_by_field_key', f.filter_by_field_key,
            'is_locked', f.is_locked
          ) ORDER BY f.sort_order
        ) FILTER (WHERE f.id IS NOT NULL), '[]'
      ) AS fields
    FROM ${SCHEMA}.ticket_categories c
    LEFT JOIN ${SCHEMA}.ticket_category_fields f ON f.category_id = c.id
    WHERE c.is_active = true
    GROUP BY c.id, c.code, c.label, c.sla_hours
    ORDER BY c.sort_order`
  );
  return { success: true, data: rows };
}

async function getPodStructure(payload) {
  await requireAgent(payload.email);
  const { rows } = await db.query(
    `SELECT site_id, district, site_name, field_officer, fo_email
     FROM ${SCHEMA}.pod_structure
     ORDER BY field_officer`
  );
  return { success: true, data: rows };
}

async function searchFoTickets(payload) {
  await requireAgent(payload.email);
  const { rows } = await db.query(
    `SELECT t.id, t.ticket_number, c.label AS category_label, s.label AS status_label,
            t.fo_name, t.fo_email, t.farmer_name, t.created_at
     FROM ${SCHEMA}.tickets t
     JOIN ${SCHEMA}.ticket_categories c ON c.id = t.category_id
     JOIN ${SCHEMA}.ticket_statuses s ON s.code = t.status_code
     WHERE (
         t.fo_name ILIKE '%' || $1 || '%'
         OR t.fo_email ILIKE '%' || $1 || '%'
         OR t.ticket_number ILIKE '%' || $1 || '%'
       )
     ORDER BY t.created_at DESC
     LIMIT 25`,
    [payload.search_term]
  );
  return { success: true, data: rows };
}

/**
 * Account-number lookup, backing Order Adjustment's locked fields in the
 * hotline form (and reusable anywhere else an account lookup would help).
 *
 * products_json in account_directory is stored as a comma-separated run of
 * JSON objects with no enclosing array brackets — a known quirk inherited
 * from the original Drive-JSON farmer directory. Wrapped here at query
 * time rather than touching the stored data or requiring every consumer
 * to know about the quirk. Confirmed still present in the live table via
 * a 5-row sample as of this writing.
 */
async function getFarmerAccount(payload) {
  await requireAgent(payload.email);
  const { rows } = await db.query(
    `SELECT
      account_number,
      client_name,
      district,
      site_id,
      site_name,
      fo_email,
      group_name,
      loan_products,
      total_credit,
      is_returning,
      is_qualifier,
      ('[' || COALESCE(products_json, '') || ']')::jsonb AS products_json
    FROM ${SCHEMA}.account_directory
    WHERE account_number = $1`,
    [payload.account_number]
  );

  if (rows.length === 0) {
    return { success: false, error: 'No account found with that number.' };
  }

  return { success: true, data: rows[0] };
}

/**
 * Creates a hotline-logged ticket. If is_fcr (first-call-resolution) is
 * true, the ticket is created already CLOSED with resolver_name/
 * resolved_at/confirmed_at/closed_at/closed_reason all pre-populated, the
 * resolution notes logged as the first comment, and a status-history row
 * recording the OPEN -> CLOSED transition — same shape updateStatus()
 * produces for a resolver-driven resolution, just condensed into one call
 * since there's no separate "mark resolved" step for an FCR call.
 *
 * If related_ticket_id is set, a system comment is cross-posted on both
 * tickets so the connection is visible in each one's own activity thread.
 *
 * Wrapped in a transaction: if any of the follow-on inserts fail, the
 * ticket itself is rolled back too rather than left half-created.
 */
async function createHotlineTicket(payload) {
  await requireAgent(payload.email);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO ${SCHEMA}.tickets (
        category_id, fo_email, fo_name, site_id, site_name,
        farmer_account, farmer_name, description, custom_fields, sla_due_at,
        source_system, caller_phone_number, logged_by_agent_email, related_ticket_id,
        status_code, resolver_name, resolved_at, confirmed_at, closed_at, closed_reason
      )
      SELECT
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9::jsonb,
        now() + (c.sla_hours || ' hours')::interval,
        'call_center', $10, $11, $12::bigint,
        CASE WHEN $13::boolean THEN 'CLOSED' ELSE 'OPEN' END,
        CASE WHEN $13::boolean THEN COALESCE(
            (SELECT name FROM ${SCHEMA}.call_center_agents WHERE email = $11),
            (SELECT name FROM ${SCHEMA}.admins WHERE email = $11)
          ) ELSE NULL END,
        CASE WHEN $13::boolean THEN now() ELSE NULL END,
        CASE WHEN $13::boolean THEN now() ELSE NULL END,
        CASE WHEN $13::boolean THEN now() ELSE NULL END,
        CASE WHEN $13::boolean THEN 'fcr_resolved' ELSE NULL END
      FROM ${SCHEMA}.ticket_categories c WHERE c.id = $1
      RETURNING id, ticket_number, status_code, created_at, related_ticket_id`,
      [
        payload.category_id, payload.fo_email, payload.fo_name, payload.site_id, payload.site_name,
        payload.farmer_account, payload.farmer_name, payload.description, payload.custom_fields,
        payload.caller_phone_number, payload.email, payload.related_ticket_id ?? null,
        Boolean(payload.is_fcr),
      ]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Failed to create ticket. Check that the category exists.' };
    }

    const ticket = rows[0];

    if (Boolean(payload.is_fcr)) {
      await client.query(
        `INSERT INTO ${SCHEMA}.ticket_comments (ticket_id, author_role, author_name, author_email, comment_text)
         SELECT $1, 'call_center',
           COALESCE(
             (SELECT name FROM ${SCHEMA}.call_center_agents WHERE email = $2),
             (SELECT name FROM ${SCHEMA}.admins WHERE email = $2)
           ),
           $2, $3`,
        [ticket.id, payload.email, payload.resolution_notes ?? '']
      );

      await client.query(
        `INSERT INTO ${SCHEMA}.ticket_status_history (ticket_id, old_status, new_status, changed_by_role, changed_by, note)
         VALUES ($1, 'OPEN', 'CLOSED', 'call_center', $2, 'Resolved on first call (FCR)')`,
        [ticket.id, payload.email]
      );
    }

    if (ticket.related_ticket_id != null) {
      await client.query(
        `INSERT INTO ${SCHEMA}.ticket_comments (ticket_id, author_role, comment_text)
         SELECT $1, 'system', 'Linked as a follow-up to ' || ticket_number
         FROM ${SCHEMA}.tickets WHERE id = $2`,
        [ticket.id, ticket.related_ticket_id]
      );

      await client.query(
        `INSERT INTO ${SCHEMA}.ticket_comments (ticket_id, author_role, comment_text)
         SELECT $1, 'system', 'A follow-up call was logged: ' || ticket_number
         FROM ${SCHEMA}.tickets WHERE id = $2`,
        [ticket.related_ticket_id, ticket.id]
      );
    }

    await client.query('COMMIT');
    return { success: true, data: ticket };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  requireAgent,
  getTicketCategories,
  getPodStructure,
  searchFoTickets,
  getFarmerAccount,
  createHotlineTicket,
};