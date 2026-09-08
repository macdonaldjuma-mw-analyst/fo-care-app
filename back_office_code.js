/**
 * FO Care — Back Office Console
 * Serves Resolver, Manager, and Admin views from one Apps Script project,
 * role-routed client-side based on getUserProfile(). Separate project and
 * separate webhook from the FO-facing FO Care app.
 */

// Same OAF logo as the FO app, for brand consistency.
var LOGO_FILE_ID = '18f8Hu2MBRhLO1Xyerem4tuJRFyrlJ2ye';

// n8n webhook endpoint for this back-office app.
// TODO: replace with your actual production URL once activated.
var BACKOFFICE_WEBHOOK_URL = 'https://automations.oneacrefund.org/webhook/fo_care_backoffice';

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('FO Care — Back Office Console')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getLogoBase64() {
  try {
    var file = DriveApp.getFileById(LOGO_FILE_ID);
    var blob = file.getBlob();
    return { success: true, data: 'data:' + file.getMimeType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  } catch (error) {
    console.warn("Failed to retrieve logo: " + error.toString());
    return { success: false, data: "" };
  }
}

function getActiveEmail_() {
  return Session.getActiveUser().getEmail().toLowerCase().trim();
}

/**
 * Shared helper — calls the back-office webhook with action+payload,
 * attaches the auth header, normalizes the response. Same pattern as
 * the FO app's callFoCareWebhook_.
 */
function callBackOfficeWebhook_(action, payload) {
  try {
    var secret = PropertiesService.getScriptProperties().getProperty('Resolver_Bo_Hook');
    if (!secret) {
      throw new Error("Resolver_Bo_Hook is not configured in Script Properties.");
    }

    var response = UrlFetchApp.fetch(BACKOFFICE_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-FOCare-Backoffice-Secret': secret },
      payload: JSON.stringify({ action: action, payload: payload || {} }),
      muteHttpExceptions: true
    });

    var httpCode = response.getResponseCode();
    var rawBody = response.getContentText();
    var parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch (parseError) {
      throw new Error("Webhook returned a non-JSON response (HTTP " + httpCode + "): " + rawBody);
    }

    if (httpCode !== 200 || !parsed.success) {
      throw new Error(parsed.error || ("Webhook call failed with HTTP " + httpCode));
    }
    return { success: true, data: parsed.data };
  } catch (error) {
    console.error("callBackOfficeWebhook_ [" + action + "] failed: " + error.toString());
    return { success: false, error: error.toString() };
  }
}

/** Foundational — who is this, and what roles/access do they have. */
function getUserProfile() {
  try {
    var email = getActiveEmail_();
    if (!email) throw new Error("Unable to resolve the active user's email.");
    return callBackOfficeWebhook_('get_user_profile', { email: email });
  } catch (error) {
    console.error("Failed in getUserProfile: " + error.toString());
    return { success: false, error: error.toString() };
  }
}

/* ==================== Resolver actions ==================== */

function getTickets(filters) {
  var payload = Object.assign({ email: getActiveEmail_() }, filters || {});
  return callBackOfficeWebhook_('get_tickets', payload);
}

function getTicketDetail(ticketId) {
  return callBackOfficeWebhook_('get_ticket_detail', { ticket_id: ticketId, email: getActiveEmail_() });
}

function addComment(ticketId, commentText) {
  return callBackOfficeWebhook_('add_comment', { ticket_id: ticketId, email: getActiveEmail_(), comment_text: commentText });
}

function updateTicketStatus(ticketId, newStatus) {
  return callBackOfficeWebhook_('update_status', { ticket_id: ticketId, email: getActiveEmail_(), new_status: newStatus });
}

function reassignTicket(ticketId, newResolverEmail) {
  return callBackOfficeWebhook_('reassign_ticket', { ticket_id: ticketId, email: getActiveEmail_(), new_resolver_email: newResolverEmail });
}

function getMyResolvers() {
  return callBackOfficeWebhook_('get_my_resolvers', { email: getActiveEmail_() });
}

/* ==================== Manager actions ==================== */

function getDashboardSummary() {
  return callBackOfficeWebhook_('get_dashboard_summary', { email: getActiveEmail_() });
}

function getSlaBreaches() {
  return callBackOfficeWebhook_('get_sla_breaches', { email: getActiveEmail_() });
}

function getResolverPerformance(dateFrom, dateTo) {
  return callBackOfficeWebhook_('get_resolver_performance', {
    email: getActiveEmail_(),
    date_from: dateFrom || null,
    date_to: dateTo || null
  });
}

function exportTicketHistory(dateFrom, dateTo) {
  return callBackOfficeWebhook_('export_ticket_history', {
    email: getActiveEmail_(),
    date_from: dateFrom || null,
    date_to: dateTo || null
  });
}

/* ==================== Admin actions ====================
 * Built and wired now; will error until the corresponding n8n
 * branches are finished. That's expected. */

function adminListCategories() {
  return callBackOfficeWebhook_('admin_list_categories', { email: getActiveEmail_() });
}

function adminCreateCategory(category) {
  return callBackOfficeWebhook_('admin_create_category', Object.assign({ email: getActiveEmail_() }, category));
}

function adminUpdateCategory(category) {
  return callBackOfficeWebhook_('admin_update_category', Object.assign({ email: getActiveEmail_() }, category));
}

function adminListCategoryFields(categoryId) {
  return callBackOfficeWebhook_('admin_list_category_fields', { email: getActiveEmail_(), category_id: categoryId });
}

function adminCreateCategoryField(field) {
  return callBackOfficeWebhook_('admin_create_category_field', Object.assign({ email: getActiveEmail_() }, field));
}

function adminUpdateCategoryField(field) {
  return callBackOfficeWebhook_('admin_update_category_field', Object.assign({ email: getActiveEmail_() }, field));
}

function adminDeleteCategoryField(fieldId) {
  return callBackOfficeWebhook_('admin_delete_category_field', { email: getActiveEmail_(), field_id: fieldId });
}

function adminListResolvers() {
  return callBackOfficeWebhook_('admin_list_resolvers', { email: getActiveEmail_() });
}

function adminAddResolver(resolver) {
  // caller_email (not email) — resolver.email is the NEW resolver's address,
  // and would silently clobber the caller's identity if both used the 'email' key.
  return callBackOfficeWebhook_('admin_add_resolver', Object.assign({ caller_email: getActiveEmail_() }, resolver));
}

function adminUpdateResolver(resolver) {
  return callBackOfficeWebhook_('admin_update_resolver', Object.assign({ caller_email: getActiveEmail_() }, resolver));
}

function adminSetResolverCategories(resolverEmail, categoryIds) {
  return callBackOfficeWebhook_('admin_set_resolver_categories', {
    email: getActiveEmail_(),
    resolver_email: resolverEmail,
    category_ids: categoryIds
  });
}

function adminListManagers() {
  return callBackOfficeWebhook_('admin_list_managers', { email: getActiveEmail_() });
}

function adminAddManager(manager) {
  // caller_email (not email) — see adminAddResolver comment above.
  return callBackOfficeWebhook_('admin_add_manager', Object.assign({ caller_email: getActiveEmail_() }, manager));
}

function adminUpdateManager(manager) {
  return callBackOfficeWebhook_('admin_update_manager', Object.assign({ caller_email: getActiveEmail_() }, manager));
}

function adminListAdmins() {
  return callBackOfficeWebhook_('admin_list_admins', { email: getActiveEmail_() });
}

function adminAddAdmin(admin) {
  // caller_email (not email) — see adminAddResolver comment above.
  return callBackOfficeWebhook_('admin_add_admin', Object.assign({ caller_email: getActiveEmail_() }, admin));
}

function adminUpdateAdmin(admin) {
  return callBackOfficeWebhook_('admin_update_admin', Object.assign({ caller_email: getActiveEmail_() }, admin));
}

function adminGetAuditLog(dateFrom, dateTo, actorEmail) {
  return callBackOfficeWebhook_('admin_get_audit_log', {
    email: getActiveEmail_(),
    date_from: dateFrom || null,
    date_to: dateTo || null,
    actor_email: actorEmail || null
  });
}

/* ==================== Call Center / Hotline Intake actions ==================== */

function getTicketCategoriesForIntake() {
  return callBackOfficeWebhook_('get_ticket_categories', { email: getActiveEmail_() });
}

function getPodStructureForIntake() {
  return callBackOfficeWebhook_('get_pod_structure', { email: getActiveEmail_() });
}

function searchFoTickets(searchTerm) {
  return callBackOfficeWebhook_('search_fo_tickets', { email: getActiveEmail_(), search_term: searchTerm });
}

function createHotlineTicket(ticketData) {
  var payload = Object.assign({ email: getActiveEmail_() }, ticketData);
  return callBackOfficeWebhook_('create_hotline_ticket', payload);
}