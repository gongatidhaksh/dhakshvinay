import { readFile } from 'node:fs/promises';
import { createPool } from 'mysql2/promise';

export async function openDatabase() {
  const { MYSQL_URL, MYSQL_TLS, MYSQL_CA_CERT } = process.env;
  if (!MYSQL_URL) throw new Error('Set MYSQL_URL to a MySQL connection string.');
  const url = new URL(MYSQL_URL);
  if (url.protocol !== 'mysql:' || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('Use a mysql:// URL that includes the database name.');
  }
  const pool = createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    charset: 'utf8mb4',
    connectionLimit: 5,
    ssl: MYSQL_TLS === 'true' ? {
      rejectUnauthorized: true,
      verifyIdentity: true,
      ca: MYSQL_CA_CERT?.replace(/\\n/g, '\n')
    } : undefined
  });
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  return {
    query: async (sql, params) => (await pool.execute(sql, params))[0],
    async transaction(task) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await task(async (sql, params) => (await conn.execute(sql, params))[0]);
        await conn.commit();
        return result;
      } catch (error) {
        try {
          await conn.rollback();
        } catch {
          conn.destroy();
        }
        throw error;
      } finally {
        conn.release();
      }
    }
  };
}

