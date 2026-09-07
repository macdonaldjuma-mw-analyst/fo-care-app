import express from 'express';
const { ApolloServer } = require('apollo-server-express');
const cors = require('cors');
const typeDefs = require('./schema');
const resolvers = require('./resolvers');

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Cloud Run Health Check Route (Responds instantly to startup probes)
  app.get('/', (req, res) => {
    res.status(200).send('FO Care GraphQL Backend Operational');
  });

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }) => {
      const token = req.headers.authorization || '';
      return { token };
    },
  });

  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  const PORT = parseInt(process.env.PORT || '8080', 10);
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Apollo GraphQL server running on port ${PORT}/graphql`);
  });
}

startServer().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1); // Force container to crash immediately so Cloud Run logs the exact trace
});