// Handles communication with the Apollo GraphQL Backend deployed on Cloud Run

const GRAPHQL_URL = 'https://YOUR-CLOUD-RUN-URL.run.app/graphql';
// Mock token for now; in production, this comes from login state
const AUTH_TOKEN = 'mock-resolver-token-123'; 

export async function fetchGraphQL(query, variables = {}) {
  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': AUTH_TOKEN
      },
      body: JSON.stringify({ query, variables })
    });

    const result = await response.json();
    if (result.errors) {
      console.error('GraphQL Errors:', result.errors);
      throw new Error(result.errors[0].message);
    }
    return result.data;
  } catch (error) {
    console.error('Network or Parse Error:', error);
    throw error;
  }
}

// Queries
export const QUERIES = {
  GET_QUEUE: `
    query GetQueue($resolverId: ID!, $status: TicketStatus) {
      resolverQueue(resolverId: $resolverId, status: $status) {
        id
        ticketCode
        categoryName
        statusCode
        slaDueAt
        isSlaBreached
        podDistrict
      }
    }
  `,
  // Add GET_TICKET_DETAIL here
};

// Mutations
export const MUTATIONS = {
  UPDATE_STATUS: `
    mutation UpdateStatus($ticketId: ID!, $resolverId: ID!, $newStatus: TicketStatus!) {
      updateTicketStatus(ticketId: $ticketId, resolverId: $resolverId, newStatus: $newStatus) {
        id
        statusCode
      }
    }
  `
};