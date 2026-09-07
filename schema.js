const { gql } = require('apollo-server-express');

const typeDefs = gql`
  enum TicketStatus {
    OPEN
    IN_PROGRESS
    RESOLVED_PENDING_CONFIRMATION
    CLOSED
    REOPENED
  }

  type Ticket {
    id: ID!
    ticketCode: String!
    title: String!
    description: String
    statusCode: TicketStatus!
    categoryId: ID!
    categoryName: String
    podDistrict: String
    slaHours: Int
    slaDueAt: String
    isSlaBreached: Boolean
    assignedResolverId: ID
    createdAt: String!
    updatedAt: String!
    categoryFields: [CategoryFieldValue]
    comments: [TicketComment]
    history: [StatusHistory]
  }

  type CategoryFieldValue {
    fieldKey: String!
    fieldLabel: String!
    value: String
  }

  type TicketComment {
    id: ID!
    userId: ID!
    comment: String!
    isInternal: Boolean!
    createdAt: String!
  }

  type StatusHistory {
    id: ID!
    oldStatus: String
    newStatus: String!
    changedBy: ID!
    changedAt: String!
  }

  type Query {
    resolverQueue(resolverId: ID!, status: TicketStatus): [Ticket!]!
    ticketDetail(ticketId: ID!): Ticket
  }

  type Mutation {
    updateTicketStatus(
      ticketId: ID!
      resolverId: ID!
      newStatus: TicketStatus!
      comment: String
    ): Ticket!

    reassignTicket(
      ticketId: ID!
      resolverId: ID!
      targetResolverId: ID!
      reason: String
    ): Ticket!

    addComment(
      ticketId: ID!
      userId: ID!
      comment: String!
      isInternal: Boolean!
    ): TicketComment!
  }
`;

module.exports = typeDefs;