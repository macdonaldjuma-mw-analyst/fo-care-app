const { Pool } = require('pg');

// Persistent connection pool to Cloud SQL (PostgreSQL)
const pool = new Pool({
  host: process.env.DB_HOST || '/cloudsql/YOUR_INSTANCE_CONNECTION_NAME',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'fo_care_app',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected database client error:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};