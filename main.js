import { fetchGraphQL, QUERIES, MUTATIONS } from './api.js';
import { state, updateTickets, setFilter, getFilteredTickets } from './state.js';

// DOM Elements
const elements = {
  ticketList: document.getElementById('ticket-list'),
  loading: document.getElementById('loading-indicator'),
  refreshBtn: document.getElementById('refresh-btn'),
  statusFilters: document.getElementById('status-filters'),
  breachCount: document.getElementById('breach-count'),
  drawer: document.getElementById('ticket-drawer'),
  drawerPanel: document.getElementById('drawer-panel'),
  closeDrawer: document.getElementById('close-drawer'),
};

// Utility: Format Status Badge
function getStatusBadge(status) {
  const styles = {
    OPEN: 'bg-blue-100 text-blue-800 border-blue-200',
    IN_PROGRESS: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    RESOLVED_PENDING_CONFIRMATION: 'bg-purple-100 text-purple-800 border-purple-200',
  };
  const style = styles[status] || 'bg-gray-100 text-gray-800 border-gray-200';
  return `<span class="px-2 py-1 text-xs font-semibold rounded border ${style}">${status.replace(/_/g, ' ')}</span>`;
}

// Utility: Format Date
function formatSLA(dateStr, isBreached) {
  if (!dateStr) return '<span class="text-gray-400">-</span>';
  const date = new Date(dateStr);
  const formatted = date.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  
  if (isBreached) {
    return `<span class="text-red-600 font-semibold bg-red-50 px-1 rounded">⚠️ ${formatted}</span>`;
  }
  return `<span class="text-gray-600">${formatted}</span>`;
}

// Render Queue Table
function renderQueue() {
  const tickets = getFilteredTickets();
  elements.ticketList.innerHTML = '';

  if (tickets.length === 0) {
    elements.ticketList.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500">No tickets found for this filter.</td></tr>`;
    return;
  }

  let breachedCount = 0;

  tickets.forEach(ticket => {
    if (ticket.isSlaBreached) breachedCount++;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-100';
    tr.onclick = () => openDrawer(ticket);

    tr.innerHTML = `
      <td class="p-4 font-mono font-medium text-brand-dark">${ticket.ticketCode}</td>
      <td class="p-4 text-gray-700">${ticket.categoryName}</td>
      <td class="p-4">${getStatusBadge(ticket.statusCode)}</td>
      <td class="p-4">${formatSLA(ticket.slaDueAt, ticket.isSlaBreached)}</td>
      <td class="p-4 text-gray-500">${ticket.podDistrict || '-'}</td>
    `;
    elements.ticketList.appendChild(tr);
  });

  elements.breachCount.textContent = breachedCount;
}

// Fetch Data from GraphQL
async function loadQueue() {
  elements.loading.classList.remove('hidden');
  elements.ticketList.innerHTML = '';
  
  try {
    const variables = { 
      resolverId: state.resolverId,
      status: state.currentFilter === 'ALL' ? null : state.currentFilter
    };
    
    // In a real app, this calls fetchGraphQL(QUERIES.GET_QUEUE, variables)
    // For prototype testing, we'll mock the response:
    const mockData = [
      { id: '1', ticketCode: 'TKT-1042', categoryName: 'Network Down', statusCode: 'OPEN', slaDueAt: new Date(Date.now() - 3600000).toISOString(), isSlaBreached: true, podDistrict: 'Zomba North' },
      { id: '2', ticketCode: 'TKT-1045', categoryName: 'Hardware Replacement', statusCode: 'IN_PROGRESS', slaDueAt: new Date(Date.now() + 86400000).toISOString(), isSlaBreached: false, podDistrict: 'Blantyre' }
    ];
    
    updateTickets(mockData);
    renderQueue();
  } catch (err) {
    console.error(err);
    elements.ticketList.innerHTML = `<tr><td colspan="5" class="p-4 text-red-500">Error loading queue.</td></tr>`;
  } finally {
    elements.loading.classList.add('hidden');
  }
}

// Drawer Logic
function openDrawer(ticket) {
  state.selectedTicket = ticket;
  document.getElementById('drawer-title').textContent = ticket.ticketCode;
  document.getElementById('drawer-body').innerHTML = `<p>Loading details for ${ticket.categoryName}...</p>`;
  
  elements.drawer.classList.remove('hidden');
  // Small delay to allow display:block to apply before animating transform
  setTimeout(() => {
    elements.drawerPanel.classList.remove('translate-x-full');
  }, 10);
}

function closeDrawer() {
  elements.drawerPanel.classList.add('translate-x-full');
  setTimeout(() => {
    elements.drawer.classList.add('hidden');
    state.selectedTicket = null;
  }, 300); // Matches Tailwind transition duration
}

// Event Listeners
elements.refreshBtn.addEventListener('click', loadQueue);
elements.closeDrawer.addEventListener('click', closeDrawer);

// Filter Button Clicks
elements.statusFilters.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON') {
    // Update active UI styling
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.remove('bg-brand-light', 'text-brand-dark');
      btn.classList.add('text-gray-700', 'hover:bg-gray-100');
    });
    e.target.classList.remove('text-gray-700', 'hover:bg-gray-100');
    e.target.classList.add('bg-brand-light', 'text-brand-dark');

    // Update state and re-render
    setFilter(e.target.dataset.status);
    loadQueue(); // Refetch from server based on new filter
  }
});

// Init
document.addEventListener('DOMContentLoaded', loadQueue);