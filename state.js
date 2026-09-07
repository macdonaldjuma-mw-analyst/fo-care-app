// Central store for the application state

export const state = {
  resolverId: 'res_001', // Hardcoded for prototype; normally from auth context
  currentFilter: 'ALL',  // 'ALL', 'OPEN', 'IN_PROGRESS'
  tickets: [],
  selectedTicket: null,
  isDrawerOpen: false,
};

export function updateTickets(newTickets) {
  state.tickets = newTickets;
}

export function setFilter(status) {
  state.currentFilter = status;
}

export function getFilteredTickets() {
  if (state.currentFilter === 'ALL') {
    return state.tickets;
  }
  return state.tickets.filter(t => t.statusCode === state.currentFilter);
}