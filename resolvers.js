const db = require('./db');

// Valid status state transition guardrails
const VALID_TRANSITIONS = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['RESOLVED_PENDING_CONFIRMATION'],
  RESOLVED_PENDING_CONFIRMATION: ['REOPENED'], // Field Officer confirms CLOSED or requests REOPENED
  REOPENED: ['IN_PROGRESS']
};

const resolvers = {
  Query: {
    resolverQueue: async (_, { resolverId, status }) => {
      // Fetch queue filtered by category access permissions
      let sql = `
        SELECT t.*, c.name as category_name
        FROM tickets t
        JOIN ticket_categories c ON t.category_id = c.id
        JOIN resolver_category_access rca ON rca.category_id = t.category_id
        WHERE rca.resolver_id = $1
      `;
      const params = [resolverId];

      if (status) {
        sql += ` AND t.status_code = $2`;
        params.push(status);
      }

      sql += ` ORDER BY t.created_at DESC`;

      const { rows } = await db.query(sql, params);
      const now = new Date();

      return rows.map(row => ({
        id: row.id,
        ticketCode: row.ticket_code,
        title: row.title,
        description: row.description,
        statusCode: row.status_code,
        categoryId: row.category_id,
        categoryName: row.category_name,
        podDistrict: row.pod_district,
        slaHours: row.sla_hours,
        slaDueAt: row.sla_due_at,
        isSlaBreached: row.sla_due_at ? new Date(row.sla_due_at) < now : false,
        assignedResolverId: row.assigned_resolver_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    },

    ticketDetail: async (_, { ticketId }) => {
      const { rows } = await db.query(`SELECT * FROM tickets WHERE id = $1`, [ticketId]);
      if (!rows.length) throw new Error('Ticket not found');
      const ticket = rows[0];

      const [commentsRes, historyRes] = await Promise.all([
        db.query(`SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticketId]),
        db.query(`SELECT * FROM ticket_status_history WHERE ticket_id = $1 ORDER BY changed_at ASC`, [ticketId])
      ]);

      return {
        id: ticket.id,
        ticketCode: ticket.ticket_code,
        title: ticket.title,
        description: ticket.description,
        statusCode: ticket.status_code,
        categoryId: ticket.category_id,
        podDistrict: ticket.pod_district,
        slaHours: ticket.sla_hours,
        slaDueAt: ticket.sla_due_at,
        assignedResolverId: ticket.assigned_resolver_id,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        comments: commentsRes.rows.map(c => ({
          id: c.id,
          userId: c.user_id,
          comment: c.comment,
          isInternal: c.is_internal,
          createdAt: c.created_at
        })),
        history: historyRes.rows.map(h => ({
          id: h.id,
          oldStatus: h.old_status,
          newStatus: h.new_status,
          changedBy: h.changed_by,
          changedAt: h.changed_at
        }))
      };
    }
  },

  Mutation: {
    updateTicketStatus: async (_, { ticketId, resolverId, newStatus, comment }) => {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        const ticketRes = await client.query(`SELECT status_code FROM tickets WHERE id = $1 FOR UPDATE`, [ticketId]);
        if (!ticketRes.rows.length) throw new Error('Ticket not found');
        
        const currentStatus = ticketRes.rows[0].status_code;

        // Guardrail enforcement
        const allowed = VALID_TRANSITIONS[currentStatus] || [];
        if (!allowed.includes(newStatus)) {
          throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}`);
        }

        // Update ticket status
        const updateRes = await client.query(
          `UPDATE tickets SET status_code = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
          [newStatus, ticketId]
        );

        // Record history
        await client.query(
          `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, changed_by, changed_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [ticketId, currentStatus, newStatus, resolverId]
        );

        // Optional resolution comment
        if (comment) {
          await client.query(
            `INSERT INTO ticket_comments (ticket_id, user_id, comment, is_internal, created_at)
             VALUES ($1, $2, $3, false, NOW())`,
            [ticketId, resolverId, comment]
          );
        }

        await client.query('COMMIT');
        
        const updated = updateRes.rows[0];
        return {
          id: updated.id,
          ticketCode: updated.ticket_code,
          statusCode: updated.status_code,
          updatedAt: updated.updated_at
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    reassignTicket: async (_, { ticketId, resolverId, targetResolverId, reason }) => {
      const { rows } = await db.query(
        `UPDATE tickets SET assigned_resolver_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [targetResolverId, ticketId]
      );
      if (!rows.length) throw new Error('Ticket not found');

      if (reason) {
        await db.query(
          `INSERT INTO ticket_comments (ticket_id, user_id, comment, is_internal, created_at)
           VALUES ($1, $2, $3, true, NOW())`,
          [ticketId, resolverId, `[Reassigned to ${targetResolverId}]: ${reason}`]
        );
      }

      return { id: rows[0].id, ticketCode: rows[0].ticket_code, assignedResolverId: rows[0].assigned_resolver_id };
    },

    addComment: async (_, { ticketId, userId, comment, isInternal }) => {
      const { rows } = await db.query(
        `INSERT INTO ticket_comments (ticket_id, user_id, comment, is_internal, created_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
        [ticketId, userId, comment, isInternal]
      );
      return {
        id: rows[0].id,
        userId: rows[0].user_id,
        comment: rows[0].comment,
        isInternal: rows[0].is_internal,
        createdAt: rows[0].created_at
      };
    }
  }
};

module.exports = resolvers;