import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

export function readSecretOrFatal(secretName, envFallbackName = null) {
  const secretPath = path.join('/run/secrets', secretName);
  if (fs.existsSync(secretPath)) {
    try {
      const val = fs.readFileSync(secretPath, 'utf8').trim();
      if (val.length > 0) return val;
    } catch (err) {
      console.error(`[FATAL] Error reading secret file ${secretPath}:`, err.message);
      process.exit(1);
    }
  }
  if (envFallbackName && process.env[envFallbackName]) {
    const val = process.env[envFallbackName].trim();
    if (val.length > 0) return val;
  }
  console.error(`[FATAL] Required secret missing: /run/secrets/${secretName}${envFallbackName ? ` (or env ${envFallbackName})` : ''}. Terminating immediately (fail-closed).`);
  process.exit(1);
}

const DB_HOST = process.env.DB_HOST || 'mariadb';
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
const DB_USER = process.env.DB_USER || 'shopuser';
const DB_NAME = process.env.DB_NAME || 'shopdb';

// Read DB password with fail-closed enforcement
const DB_PASSWORD = readSecretOrFatal('db_password', 'DB_PASSWORD');

export const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 5000
});

export async function checkDbHealth() {
  try {
    const [rows] = await pool.query('SELECT 1 AS healthy');
    return rows && rows[0] && rows[0].healthy === 1;
  } catch (err) {
    console.error('[DB HEALTH CHECK ERROR]', err.message);
    return false;
  }
}
