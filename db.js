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
  // External host requires SSL. rejectUnauthorized:false accepts self-signed certs,
  // common on managed Postgres hosts. Set DB_SSL_REJECT_UNAUTHORIZED=true in env
  // if your host has a trusted CA cert and you want strict verification instead.
  ssl: process.env.DB_SSL === 'false'
    ? false
    : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' },
});

pool.on('error', (err) => {
  console.error('Unexpected database client error:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};