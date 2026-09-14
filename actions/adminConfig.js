const db = require('../db');
const { requireAdmin } = require('./admin');

const SCHEMA = '"FO_CARE_APP"';

/* ==================== Categories ==================== */

async function adminListCategories(payload) {
  await requireAdmin(payload.email);
  const { rows } = await db.query(
    `SELECT id, code, label, ticket_prefix, sla_hours, is_active, sort_order
     FROM ${SCHEMA}.ticket_categories ORDER BY sort_order`
  );
  return {
    success: true,
    data: rows.map((row) => ({
      id: Number(row.id),
      code: row.code || '',
      label: row.label || '',
      ticket_prefix: row.ticket_prefix || '',
      sla_hours: Number(row.sla_hours || 0),
      is_active: Boolean(row.is_active),
      sort_order: Number(row.sort_order || 0),
    })),
  };
}

async function adminCreateCategory(payload) {
  await requireAdmin(payload.caller_email);
  const { rows } = await db.query(
    `INSERT INTO ${SCHEMA}.ticket_categories (code, label, ticket_prefix, sla_hours, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, code, label, ticket_prefix, sla_hours, is_active, sort_order`,
    [payload.code, payload.label, payload.ticket_prefix, payload.sla_hours, payload.sort_order]
  );
  return { success: true, data: rows };
}

async function adminUpdateCategory(payload) {
  await requireAdmin(payload.caller_email);
  const { rows } = await db.query(
    `UPDATE ${SCHEMA}.ticket_categories
     SET label = $2, sla_hours = $3, is_active = $4, sort_order = $5
     WHERE id = $1
     RETURNING id, code, label, sla_hours, is_active, sort_order`,
    [payload.category_id, payload.label, payload.sla_hours, payload.is_active, payload.sort_order]
  );
  return { success: true, data: rows };
}

/* ==================== Category fields ====================
 * admin_create_category_field, admin_update_category_field, and
 * admin_delete_category_field are FIXED here per your decision: n8n went
 * straight from Postgres to Respond-to-Webhook with no {success,data}
 * wrapper, so Back_Office_Code.gs's `!parsed.success` check very likely
 * treated every successful write as a failure. */

async function adminListCategoryFields(payload) {
  await requireAdmin(payload.email);
  const { rows } = await db.query(
    `SELECT id, category_id, field_key, label, field_type, is_required, options, sort_order,
            depends_on_field_key, depends_on_value, options_source, filter_by_field_key, is_locked
     FROM ${SCHEMA}.ticket_category_fields
     WHERE category_id = $1 ORDER BY sort_order`,
    [payload.category_id]
  );
  return { success: true, data: rows };
}

async function adminCreateCategoryField(payload) {
  await requireAdmin(payload.caller_email);
  const { rows } = await db.query(
    `INSERT INTO ${SCHEMA}.ticket_category_fields
       (category_id, field_key, label, field_type, is_required, options, sort_order,
        depends_on_field_key, depends_on_value, options_source, filter_by_field_key, is_locked)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
     RETURNING id, field_key, label`,
    [
      payload.category_id, payload.field_key, payload.label, payload.field_type,
      payload.is_required, payload.options, payload.sort_order, payload.depends_on_field_key,
      payload.depends_on_value, payload.options_source, payload.filter_by_field_key, payload.is_locked,
    ]
  );
  return { success: true, data: rows };
}

async function adminUpdateCategoryField(payload) {
  await requireAdmin(payload.caller_email);
  const { rows } = await db.query(
    `UPDATE ${SCHEMA}.ticket_category_fields
     SET label = $2, field_type = $3, is_required = $4, options = $5::jsonb, sort_order = $6,
         depends_on_field_key = $7, depends_on_value = $8, options_source = $9,
         filter_by_field_key = $10, is_locked = $11
     WHERE id = $1
     RETURNING id, field_key, label`,
    [
      payload.field_id, payload.label, payload.field_type, payload.is_required, payload.options,
      payload.sort_order, payload.depends_on_field_key, payload.depends_on_value,
      payload.options_source, payload.filter_by_field_key, payload.is_locked,
    ]
  );
  return { success: true, data: rows };
}

async function adminDeleteCategoryField(payload) {
  await requireAdmin(payload.caller_email);
  const { rows } = await db.query(
    `DELETE FROM ${SCHEMA}.ticket_category_fields WHERE id = $1 RETURNING id, field_key`,
    [payload.field_id]
  );
  return { success: true, data: rows };
}

/* ==================== Resolver list / category assignment ==================== */

async function adminListResolvers(payload) {
  await requireAdmin(payload.email);
  const { rows } = await db.query(
    `SELECT r.email, r.name, r.is_active,
       COALESCE(json_agg(rca.category_id) FILTER (WHERE rca.category_id IS NOT NULL), '[]') AS category_ids
     FROM ${SCHEMA}.resolvers r
     LEFT JOIN ${SCHEMA}.resolver_category_access rca ON rca.resolver_email = r.email
     GROUP BY r.email, r.name, r.is_active
     ORDER BY r.name`
  );
  return {
    success: true,
    data: rows.map((row) => ({
      email: row.email,
      name: row.name || '',
      is_active: Boolean(row.is_active),
      category_ids: Array.isArray(row.category_ids) ? row.category_ids.map(Number) : [],
    })),
  };
}

/**
 * FIXED per your decision (same class as category fields): n8n's second
 * step (the INSERT) had no RETURNING clause and no wrapper Code node, so
 * this almost certainly reported false failures too. Also wrapped both
 * steps in a transaction — n8n ran DELETE then INSERT as two separate
 * unguarded Postgres nodes, so a failure between them could leave a
 * resolver with zero category access until manually fixed.
 */
async function adminSetResolverCategories(payload) {
  await requireAdmin(payload.email);
  const categoryIds = Array.isArray(payload.category_ids) ? payload.category_ids : [];
  const resolverEmail = payload.resolver_email;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM ${SCHEMA}.resolver_category_access WHERE resolver_email = $1`,
      [resolverEmail]
    );
    if (categoryIds.length > 0) {
      await client.query(
        `INSERT INTO ${SCHEMA}.resolver_category_access (resolver_email, category_id)
         SELECT $1, x::int FROM unnest($2::int[]) AS x`,
        [resolverEmail, categoryIds]
      );
    }
    await client.query('COMMIT');
    return { success: true, data: { resolver_email: resolverEmail, category_ids: categoryIds } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ==================== Audit log ====================
 * GATED per your decision — n8n had no Admin_gate in front of this at all. */

async function adminGetAuditLog(payload) {
  await requireAdmin(payload.email);
  const dateFrom = payload.date_from ?? null;
  const dateTo = payload.date_to ?? null;
  const actorEmail = payload.actor_email ?? null;

  const { rows } = await db.query(
    `SELECT actor_email, action, target_type, target_id, details, created_at
     FROM ${SCHEMA}.admin_audit_log
     WHERE created_at BETWEEN
         COALESCE($1::timestamptz, date_trunc('month', now()))
         AND COALESCE($2::timestamptz, now())
       AND ($3::text IS NULL OR actor_email = $3::text)
     ORDER BY created_at DESC`,
    [dateFrom, dateTo, actorEmail]
  );
  return { success: true, data: rows };
}

module.exports = {
  adminListCategories,
  adminCreateCategory,
  adminUpdateCategory,
  adminListCategoryFields,
  adminCreateCategoryField,
  adminUpdateCategoryField,
  adminDeleteCategoryField,
  adminListResolvers,
  adminSetResolverCategories,
  adminGetAuditLog,
};