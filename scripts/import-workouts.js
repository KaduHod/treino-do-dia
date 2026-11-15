import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';
import { closePool, getPool } from '../services/db.js';

/**
 * Importa o antigo data/workouts.json para o MySQL.
 *
 * Uso:
 *   npm run db:import                          # lê data/workouts.json
 *   npm run db:import -- --file /caminho.json  # ou WORKOUTS_JSON_PATH=...
 *
 * É idempotente (upsert por dia/exercício) e usa o DEFAULT_USER_ID do .env.
 * Em registros já existentes, o valor mais recente (updatedAt) prevalece —
 * então importar arquivos diferentes em sequência não sobrescreve dados novos
 * com dados antigos.
 */

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = path.join(ROOT_DIR, 'data', 'workouts.json');
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fileFromArgs() {
  const index = process.argv.indexOf('--file');
  return (index >= 0 && process.argv[index + 1]) || process.env.WORKOUTS_JSON_PATH || DEFAULT_FILE;
}

function toSqlDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeEntry(raw) {
  const exerciseId = Number(raw?.exerciseId);
  if (!Number.isInteger(exerciseId) || exerciseId <= 0) return null;

  const weight = Number(raw?.weight);

  return {
    exerciseId,
    exerciseName: String(raw?.exerciseName ?? ''),
    reps: String(raw?.reps ?? '3x12'),
    weight: Number.isFinite(weight) && weight >= 0 ? weight : 0,
    done: Boolean(raw?.done),
    createdAt: toSqlDate(raw?.createdAt),
    updatedAt: toSqlDate(raw?.updatedAt ?? raw?.createdAt),
  };
}

async function readJson(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw new Error(`JSON inválido em ${file}: ${error.message}`);
    }
    throw error;
  }
}

async function importWorkouts(file, database) {
  const userId = config.database.defaultUserId;
  const days = Object.entries(database)
    .filter(([date, day]) => ISO_DATE_PATTERN.test(date) && day && typeof day === 'object')
    .sort(([left], [right]) => left.localeCompare(right));

  if (days.length === 0) {
    console.log(`[import] nenhum dia válido em ${file}`);
    return { days: 0, entries: 0 };
  }

  const connection = await getPool().getConnection();
  let dayCount = 0;
  let entryCount = 0;

  try {
    await connection.beginTransaction();

    for (const [date, day] of days) {
      const workoutCreatedAt = toSqlDate(day.createdAt);
      const workoutUpdatedAt = toSqlDate(day.updatedAt ?? day.createdAt);

      const [workoutResult] = await connection.execute(
        `INSERT INTO workouts (user_id, workout_date, created_at, updated_at)
         VALUES (?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           created_at = LEAST(workouts.created_at, new.created_at),
           updated_at = GREATEST(workouts.updated_at, new.updated_at)`,
        [userId, date, workoutCreatedAt, workoutUpdatedAt],
      );
      const workoutId = workoutResult.insertId;

      const entries = Array.isArray(day.entries)
        ? day.entries.map(normalizeEntry).filter(Boolean)
        : [];

      for (const entry of entries) {
        await connection.execute(
          `INSERT INTO workout_entries
             (workout_id, exercise_id, exercise_name, reps, weight_kg, done, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new
           ON DUPLICATE KEY UPDATE
             exercise_name = IF(new.updated_at >= workout_entries.updated_at, new.exercise_name, workout_entries.exercise_name),
             reps = IF(new.updated_at >= workout_entries.updated_at, new.reps, workout_entries.reps),
             weight_kg = IF(new.updated_at >= workout_entries.updated_at, new.weight_kg, workout_entries.weight_kg),
             done = IF(new.updated_at >= workout_entries.updated_at, new.done, workout_entries.done),
             updated_at = GREATEST(workout_entries.updated_at, new.updated_at)`,
          [
            workoutId,
            entry.exerciseId,
            entry.exerciseName,
            entry.reps,
            entry.weight,
            entry.done ? 1 : 0,
            entry.createdAt,
            entry.updatedAt,
          ],
        );
        entryCount += 1;
      }

      dayCount += 1;
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return { days: dayCount, entries: entryCount };
}

async function main() {
  const file = path.resolve(fileFromArgs());
  const database = await readJson(file);

  if (!database) {
    console.log(`[import] arquivo não encontrado: ${file} (nada a importar)`);
    return;
  }

  const { days, entries } = await importWorkouts(file, database);
  const userId = config.database.defaultUserId;

  console.log(`[import] ${file}`);
  console.log(`[import] ${days} dia(s) e ${entries} registro(s) sincronizados para o usuário #${userId}.`);
}

main()
  .catch((error) => {
    console.error('[import] erro:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
