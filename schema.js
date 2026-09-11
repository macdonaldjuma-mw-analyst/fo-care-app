const { gql } = require('apollo-server-express');

// NOTE: statusCode / newStatus are plain Strings, not an enum. The previous
// version hardcoded a TicketStatus enum (OPEN, IN_PROGRESS, ...) but that was
// never validated against the real `ticket_statuses` table (columns: code,
// label, sort_order, is_terminal). Share the actual rows from that table if
// you want this locked back down to a real enum + validated transitions.

const typeDefs = gql`
  type Ticket {
    id: ID!
    ticketNumber: String!
    categoryId: Int!
    categoryLabel: String
    statusCode: String!
    foEmail: String!
    foName: String
    siteId: String!
    siteName: String
    farmerAccount: String
    farmerName: String
    description: String!
    customFields: String
    slaDueAt: String
    isSlaBreached: Boolean
    resolverName: String
    assignedResolverEmail: String
    resolvedAt: String
    confirmedAt: String
    closedAt: String
    closedReason: String
    sourceSystem: String!
    callerPhoneNumber: String
    loggedByAgentEmail: String
    relatedTicketId: ID
    createdAt: String!
    updatedAt: String!
    comments: [TicketComment]
    history: [StatusHistory]
    attachments: [TicketAttachment]
  }

  type TicketComment {
    id: ID!
    ticketId: ID!
    authorRole: String!
    authorName: String
    authorEmail: String
    commentText: String!
    createdAt: String!
  }

  type StatusHistory {
    id: ID!
    ticketId: ID!
    oldStatus: String
    newStatus: String!
    changedByRole: String
    changedBy: String
    note: String
    changedAt: String!
  }

  type TicketAttachment {
    id: ID!
    ticketId: ID!
    fileUrl: String!
    fileName: String
    uploadedByRole: String
    uploadedAt: String!
  }

  type Query {
    # resolverEmail — resolver_category_access is keyed by email, not a numeric ID
    resolverQueue(resolverEmail: String!, status: String): [Ticket!]!
    ticketDetail(ticketId: ID!): Ticket
  }

  type Mutation {
    updateTicketStatus(
      ticketId: ID!
      resolverEmail: String!
      newStatus: String!
      note: String
    ): Ticket!

    reassignTicket(
      ticketId: ID!
      resolverEmail: String!
      targetResolverEmail: String!
      reason: String
    ): Ticket!

    addComment(
      ticketId: ID!
      authorRole: String!
      authorName: String
      authorEmail: String
      commentText: String!
    ): TicketComment!
  }
`;

module.exports = typeDefs;