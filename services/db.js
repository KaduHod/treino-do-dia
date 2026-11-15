import mysql from 'mysql2/promise';

import { config } from '../config.js';

/**
 * Pool único de conexões com o MySQL.
 *
 * dateStrings evita que DATE/DATETIME sejam convertidos para Date no fuso do
 * processo: o banco guarda UTC (my.cnf com default-time-zone=+00:00) e o
 * workoutStore converte para ISO 8601.
 */
let pool = null;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name,
      waitForConnections: true,
      connectionLimit: config.database.connectionLimit,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: true,
    });
  }

  return pool;
}

/**
 * Executa `task(connection)` dentro de uma transação, com commit/rollback e
 * devolução da conexão ao pool em qualquer caso.
 */
export async function withTransaction(task) {
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    const result = await task(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('[db] falha no rollback:', rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function pingDatabase() {
  const [rows] = await getPool().query('SELECT 1 AS ok');
  return Array.isArray(rows) && rows[0]?.ok === 1;
}

export async function closePool() {
  if (!pool) return;
  await pool.end();
  pool = null;
}
