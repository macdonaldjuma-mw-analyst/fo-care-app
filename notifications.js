/**
 * Cloud Run -> n8n notification webhook.
 *
 * Ticket-creation and reopen used to trigger Gmail sends inline, as part of
 * the same n8n workflow that wrote to Postgres. Now that those writes
 * happen on Cloud Run, the email side-effects live in their own dedicated
 * n8n webhook (fo_care_notifications) instead — same Gmail templates, same
 * lookups, just decoupled from the request/response path that the FO is
 * actually waiting on.
 *
 * IMPORTANT: this is awaited by callers, guarded by a short timeout — NOT
 * true fire-and-forget. Cloud Run only guarantees CPU while a request is
 * being actively handled; an un-awaited fetch left running after the HTTP
 * response is sent can get frozen mid-flight and never complete. Awaiting
 * with a timeout keeps the container alive long enough for the call to
 * finish, while still guaranteeing a slow or dead webhook can never fail
 * or meaningfully delay the caller's own response — every function here
 * swallows its own errors and never throws.
 */

const NOTIFICATIONS_URL = process.env.FOCARE_NOTIFICATIONS_URL;
const NOTIFICATIONS_SECRET = process.env.FOCARE_NOTIF_SECRET;
const TIMEOUT_MS = 4000;

async function sendNotification_(action, payload) {
  if (!NOTIFICATIONS_URL || !NOTIFICATIONS_SECRET) {
    console.warn(
      `Notification "${action}" skipped — FOCARE_NOTIFICATIONS_URL/FOCARE_NOTIF_SECRET not configured.`
    );
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(NOTIFICATIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FOCare-Notif-Secret': NOTIFICATIONS_SECRET,
      },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`Notification "${action}" failed with HTTP ${res.status}`);
    }
  } catch (err) {
    // Covers both network failures and the abort-on-timeout case above.
    console.error(`Notification "${action}" failed or timed out:`, err.message);
  } finally {
    clearTimeout(timer);
  }
}

async function notifyNewTicket(ticketId) {
  await sendNotification_('notify_new_ticket', { ticket_id: ticketId });
}

async function notifyTicketReopened(ticketId, reason) {
  await sendNotification_('notify_ticket_reopened', { ticket_id: ticketId, reason });
}

module.exports = { notifyNewTicket, notifyTicketReopened };