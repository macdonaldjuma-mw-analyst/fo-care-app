const express = require('express');
const adminActions = require('./actions/admin');
const ticketActions = require('./actions/tickets');
const profileActions = require('./actions/profile');
const managerActions = require('./actions/manager');
const adminConfigActions = require('./actions/adminConfig');
const hotlineActions = require('./actions/hotline');
const dashboardTrendActions = require('./actions/dashboardTrends');

const app = express();
app.use(express.json());

// Health check for Cloud Run's startup probe.
app.get('/', (req, res) => {
  res.status(200).send('FO Care Back-Office Action Router Operational');
});

// Action dispatch table. Only actions actually ported so far are listed here
// — everything else still runs through the existing n8n workflow. Add to
// this map as each action group gets verified and ported.
const ACTION_HANDLERS = {
  admin_list_managers: adminActions.adminListManagers,
  admin_add_manager: adminActions.adminAddManager,
  admin_update_manager: adminActions.adminUpdateManager,
  admin_add_resolver: adminActions.adminAddResolver,
  admin_update_resolver: adminActions.adminUpdateResolver,
  admin_list_admins: adminActions.adminListAdmins,
  admin_add_admin: adminActions.adminAddAdmin,
  admin_update_admin: adminActions.adminUpdateAdmin,
  get_tickets: ticketActions.getTickets,
  get_ticket_detail: ticketActions.getTicketDetail,
  add_comment: ticketActions.addComment,
  update_status: ticketActions.updateStatus,
  get_my_resolvers: ticketActions.getMyResolvers,
  get_user_profile: profileActions.getUserProfile,
  get_dashboard_summary: managerActions.getDashboardSummary,
  get_sla_breaches: managerActions.getSlaBreaches,
  get_resolver_performance: managerActions.getResolverPerformance,
  export_ticket_history: managerActions.exportTicketHistory,
  get_ticket_trend: dashboardTrendActions.getTicketTrend,
  get_sla_trend: dashboardTrendActions.getSlaTrend,
  get_category_deltas: dashboardTrendActions.getCategoryDeltas,
  get_creation_heatmap: dashboardTrendActions.getCreationHeatmap,
  admin_list_categories: adminConfigActions.adminListCategories,
  admin_create_category: adminConfigActions.adminCreateCategory,
  admin_update_category: adminConfigActions.adminUpdateCategory,
  admin_list_category_fields: adminConfigActions.adminListCategoryFields,
  admin_create_category_field: adminConfigActions.adminCreateCategoryField,
  admin_update_category_field: adminConfigActions.adminUpdateCategoryField,
  admin_delete_category_field: adminConfigActions.adminDeleteCategoryField,
  admin_list_resolvers: adminConfigActions.adminListResolvers,
  admin_set_resolver_categories: adminConfigActions.adminSetResolverCategories,
  admin_get_audit_log: adminConfigActions.adminGetAuditLog,
  get_ticket_categories: hotlineActions.getTicketCategories,
  get_pod_structure: hotlineActions.getPodStructure,
  search_fo_tickets: hotlineActions.searchFoTickets,
  create_hotline_ticket: hotlineActions.createHotlineTicket,
  get_farmer_account: hotlineActions.getFarmerAccount,
};

app.post('/backoffice', async (req, res) => {
  const secret = req.headers['x-focare-backoffice-secret'];
  if (!secret || secret !== process.env.RESOLVER_BO_HOOK_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { action, payload } = req.body || {};
  const handler = ACTION_HANDLERS[action];

  if (!handler) {
    // Not an error in the traditional sense — this action just hasn't been
    // migrated off n8n yet, or the action name is genuinely unknown.
    return res.status(200).json({
      success: false,
      error: `Action "${action}" is not yet available on this backend.`,
    });
  }

  try {
    const result = await handler(payload || {});
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof adminActions.AuthorizationError) {
      return res.status(200).json({ success: false, error: err.message });
    }
    console.error(`Action "${action}" failed:`, err);
    return res.status(200).json({ success: false, error: 'Internal server error.' });
  }
});

const PORT = parseInt(process.env.PORT || '8080', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Back-office action router running on port ${PORT}`);
});