const db = require('../db');

const SCHEMA = '"FO_CARE_APP"';

// Thrown when the caller fails a role check. Handled specially in the
// action-router so it always comes back as {success:false, error} with a
// clean message, never a raw 500.
class AuthorizationError extends Error {}

/**
 * Mirrors the n8n "Admin_gate" pattern exactly:
 *   SELECT email FROM admins WHERE email = $1 AND is_active = true
 * No row => not authorized. Same check, same error string, for every
 * admin-only action.
 */
async function requireAdmin(callerEmail) {
  if (!callerEmail) {
    throw new AuthorizationError('Not authorized as an admin.');
  }
  const { rows } = await db.query(
    `SELECT email FROM ${SCHEMA}.admins WHERE email = $1 AND is_active = true`,
    [callerEmail]
  );
  if (rows.length === 0) {
    throw new AuthorizationError('Not authorized as an admin.');
  }
}

/* ==================== Managers ====================
 * NOTE: previously ungated in the n8n workflow (Switch1 routed straight to
 * these three Postgres nodes with no Admin_gate in front). Now gated per
 * your decision. Response shape matches the existing working Code nodes
 * (Code in JavaScript 28/29/30) exactly: {success:true, data: <rows>}. */

async function adminListManagers(payload) {
  await requireAdmin(payload.email);
  const { rows } = await db.query(
    `SELECT email, name, is_active FROM ${SCHEMA}.managers ORDER BY name`
  );
  return { success: true, data: rows };
}

async function adminAddManager(payload) {
  // payload.email is the NEW manager's email (matches the target-entity
  // shape the frontend already sends). payload.caller_email is the admin
  // making the request — see the Back_Office_Code.gs fix.
  await requireAdmin(payload.caller_email);
  const { rows } = await db.query(
    `INSERT INTO ${SCHEMA}.managers (email, name) VALUES ($1, $2) RETURNING email, name`,
    [payload.email, payload.name]
  );
  return { success: true, data: rows };
}

async function adminUpdateManager(payload) {
  await requireAdmin(payload.caller_email);
  const { rows } = await db.query(
    `UPDATE ${SCHEMA}.managers SET name = $2, is_active = $3 WHERE email = $1
     RETURNING email, name, is_active`,
    [payload.email, payload.name, payload.is_active]
  );
  return { success: true, data: rows };
}

/* ==================== Resolvers ====================
 * admin_add_resolver was a two-step insert in n8n (resolver row, then one
 * resolver_category_access row per category_id) with no visible transaction
 * wrapping the two. Wrapping them in a real transaction here so a failure on
 * the second insert can't leave an orphaned resolver with no category
 * access — this changes only the failure path, not the success behavior. */

async function adminAddResolver(payload) {
  await requireAdmin(payload.caller_email);
  const categoryIds = Array.isArray(payload.category_ids) ? payload.category_ids : [];

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const resolverRes = await client.query(
      `INSERT INTO ${SCHEMA}.resolvers (email, name) VALUES ($1, $2) RETURNING email, name`,
      [payload.email, payload.name]
    );

    if (categoryIds.length > 0) {
      await client.query(
        `INSERT INTO ${SCHEMA}.resolver_category_access (resolver_email, category_id)
         SELECT $1, x::int FROM unnest($2::int[]) AS x`,
        [payload.email, categoryIds]
      );
    }

    await client.query('COMMIT');
    return {
      success: true,
      data: [{ ...resolverRes.rows[0], category_ids: categoryIds }],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function adminUpdateResolver(payload) {
  // Matches n8n exactly: name/is_active only. Category access changes go
  // through the separate, already-gated admin_set_resolver_categories action.
  await requireAdmin(payload.caller_email);
  const { rows } = await db.query(
    `UPDATE ${SCHEMA}.resolvers SET name = $2, is_active = $3 WHERE email = $1
     RETURNING email, name, is_active`,
    [payload.email, payload.name, payload.is_active]
  );
  return { success: true, data: rows };
}

/* ==================== Admins ====================
 * These three were dead ends in the n8n graph (SQL existed, no Code node,
 * no Respond to Webhook — confirmed via Back_Office_Code.gs's own comment
 * that these branches were never finished). Completed here following the
 * exact same shape as their now-gated manager siblings. */

async function adminListAdmins(payload) {
  await requireAdmin(payload.email);
  const { rows } = await db.query(
    `SELECT email, name, is_active FROM ${SCHEMA}.admins ORDER BY name`
  );
  return { success: true, data: rows };
}

async function adminAddAdmin(payload) {
  await requireAdmin(payload.caller_email);
  const { rows } = await db.query(
    `INSERT INTO ${SCHEMA}.admins (email, name) VALUES ($1, $2) RETURNING email, name`,
    [payload.email, payload.name]
  );
  return { success: true, data: rows };
}

async function adminUpdateAdmin(payload) {
  await requireAdmin(payload.caller_email);
  const { rows } = await db.query(
    `UPDATE ${SCHEMA}.admins SET name = $2, is_active = $3 WHERE email = $1
     RETURNING email, name, is_active`,
    [payload.email, payload.name, payload.is_active]
  );
  return { success: true, data: rows };
}

module.exports = {
  AuthorizationError,
  requireAdmin,
  adminListManagers,
  adminAddManager,
  adminUpdateManager,
  adminAddResolver,
  adminUpdateResolver,
  adminListAdmins,
  adminAddAdmin,
  adminUpdateAdmin,
};
