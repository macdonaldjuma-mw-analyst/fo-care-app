const db = require('../db');

const SCHEMA = '"FO_CARE_APP"';

/**
 * Called on every page load client-side to determine role-based routing.
 * Note: this only checks resolver/manager/admin tables — a call center
 * agent who is none of those gets name:'' and every flag false, exactly
 * matching current n8n behavior (not something I've added or changed).
 */
async function getUserProfile(payload) {
  const email = payload.email;

  const { rows } = await db.query(
    `SELECT
      $1::text AS email,
      (SELECT name FROM ${SCHEMA}.resolvers WHERE email = $1 AND is_active = true) AS resolver_name,
      (SELECT name FROM ${SCHEMA}.managers WHERE email = $1 AND is_active = true) AS manager_name,
      (SELECT name FROM ${SCHEMA}.admins WHERE email = $1 AND is_active = true) AS admin_name,
      COALESCE(
        (SELECT json_agg(json_build_object('id', c.id, 'label', c.label) ORDER BY c.sort_order)
         FROM ${SCHEMA}.resolver_category_access rca
         JOIN ${SCHEMA}.ticket_categories c ON c.id = rca.category_id
         WHERE rca.resolver_email = $1),
        '[]'
      ) AS resolver_categories`,
    [email]
  );

  const row = rows[0] || {};

  return {
    success: true,
    data: {
      email: row.email,
      name: row.resolver_name || row.manager_name || row.admin_name || '',
      is_resolver: Boolean(row.resolver_name),
      resolver_categories: row.resolver_categories || [],
      is_manager: Boolean(row.manager_name),
      is_admin: Boolean(row.admin_name),
    },
  };
}

module.exports = { getUserProfile };