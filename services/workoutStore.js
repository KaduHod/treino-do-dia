import { config } from '../config.js';
import { getPool, withTransaction } from './db.js';

/**
 * Persistência dos treinos no MySQL (schema em db/init/01-schema.sql).
 *
 * Estrutura: users -> workouts (um dia por usuário) -> workout_entries.
 * Enquanto o login não existe, todos os registros pertencem ao usuário
 * DEFAULT_USER_ID (seed "default", id 1).
 *
 * O retorno mantém o formato que o dashboard e as views já consumiam:
 * {
 *   date: '2026-11-13',
 *   entries: [
 *     { exerciseId, exerciseName, reps, weight, done, createdAt, updatedAt }
 *   ],
 *   createdAt, updatedAt
 * }
 */

const USER_ID = config.database.defaultUserId;

const ENTRY_COLUMNS = `
  e.id,
  e.workout_id,
  e.exercise_id,
  e.exercise_name,
  e.reps,
  e.weight_kg,
  e.done,
  e.created_at,
  e.updated_at
`;

function toIso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();

  const text = String(value);
  const parsed = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeWeight(value, fallback = 0) {
  const weight = Number(value);
  return Number.isFinite(weight) && weight >= 0 ? weight : fallback;
}

function mapEntry(row) {
  return {
    exerciseId: Number(row.exercise_id),
    exerciseName: row.exercise_name ?? '',
    reps: String(row.reps ?? ''),
    weight: normalizeWeight(row.weight_kg),
    done: Boolean(row.done),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function findEntry(connection, workoutId, exerciseId, { forUpdate = false } = {}) {
  const [rows] = await connection.execute(
    `SELECT ${ENTRY_COLUMNS}
       FROM workout_entries e
      WHERE e.workout_id = ? AND e.exercise_id = ?
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [workoutId, exerciseId],
  );

  return rows[0] ?? null;
}

async function touchWorkout(connection, workoutId) {
  await connection.execute(
    'UPDATE workouts SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [workoutId],
  );
}

/**
 * Dia de treino do usuário atual, com os exercícios na ordem de criação.
 */
export async function getDay(date) {
  const [workoutRows] = await getPool().execute(
    'SELECT id, created_at, updated_at FROM workouts WHERE user_id = ? AND workout_date = ? LIMIT 1',
    [USER_ID, date],
  );

  const workout = workoutRows[0];
  if (!workout) return null;

  const [entryRows] = await getPool().execute(
    `SELECT ${ENTRY_COLUMNS}
       FROM workout_entries e
      WHERE e.workout_id = ?
      ORDER BY e.id`,
    [workout.id],
  );

  return {
    date,
    entries: entryRows.map(mapEntry),
    createdAt: toIso(workout.created_at),
    updatedAt: toIso(workout.updated_at),
  };
}

/**
 * Adiciona um exercício ao dia. Se ele já existir, atualiza o nome (quando
 * informado) e o updatedAt — mesmo comportamento do armazenamento anterior.
 */
export function addEntry(date, { exerciseId, exerciseName = '', reps = '3x12', weight = 0, done = true }) {
  return withTransaction(async (connection) => {
    // Cria o dia se ainda não existir e recupera o id (inclusive no upsert).
    const [workoutResult] = await connection.execute(
      `INSERT INTO workouts (user_id, workout_date)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [USER_ID, date],
    );
    const workoutId = workoutResult.insertId;

    const existing = await findEntry(connection, workoutId, exerciseId, { forUpdate: true });

    if (existing) {
      if (exerciseName) {
        await connection.execute(
          'UPDATE workout_entries SET exercise_name = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
          [String(exerciseName), existing.id],
        );
      } else {
        await connection.execute(
          'UPDATE workout_entries SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
          [existing.id],
        );
      }

      await touchWorkout(connection, workoutId);
      return mapEntry(await findEntry(connection, workoutId, exerciseId));
    }

    await connection.execute(
      `INSERT INTO workout_entries
         (workout_id, exercise_id, exercise_name, reps, weight_kg, done)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        workoutId,
        exerciseId,
        String(exerciseName ?? ''),
        String(reps),
        normalizeWeight(weight),
        done ? 1 : 0,
      ],
    );

    await touchWorkout(connection, workoutId);
    return mapEntry(await findEntry(connection, workoutId, exerciseId));
  });
}

/**
 * Atualiza reps/carga/feito de um registro do dia.
 * Lança erro com code ENTRY_NOT_FOUND quando o exercício não está no dia.
 */
export function updateEntry(date, exerciseId, changes) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT ${ENTRY_COLUMNS}
         FROM workout_entries e
         JOIN workouts w ON w.id = e.workout_id
        WHERE w.user_id = ? AND w.workout_date = ? AND e.exercise_id = ?
        FOR UPDATE`,
      [USER_ID, date, exerciseId],
    );

    const current = rows[0];
    if (!current) {
      const error = new Error('Registro não encontrado neste dia.');
      error.code = 'ENTRY_NOT_FOUND';
      throw error;
    }

    const reps = changes.reps !== undefined ? String(changes.reps) : current.reps;
    const weight = changes.weight !== undefined
      ? normalizeWeight(changes.weight, normalizeWeight(current.weight_kg))
      : normalizeWeight(current.weight_kg);
    const done = changes.done !== undefined ? (changes.done ? 1 : 0) : current.done;

    await connection.execute(
      `UPDATE workout_entries
          SET reps = ?, weight_kg = ?, done = ?, updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
      [reps, weight, done, current.id],
    );
    await touchWorkout(connection, current.workout_id);

    const [updatedRows] = await connection.execute(
      `SELECT ${ENTRY_COLUMNS} FROM workout_entries e WHERE e.id = ?`,
      [current.id],
    );
    return mapEntry(updatedRows[0]);
  });
}

/**
 * Remove um exercício do dia. Se o dia ficar sem exercícios, a linha em
 * workouts também é removida (equivalente ao antigo "delete database[date]").
 */
export function removeEntry(date, exerciseId) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT ${ENTRY_COLUMNS}
         FROM workout_entries e
         JOIN workouts w ON w.id = e.workout_id
        WHERE w.user_id = ? AND w.workout_date = ? AND e.exercise_id = ?
        FOR UPDATE`,
      [USER_ID, date, exerciseId],
    );

    const entry = rows[0];
    if (!entry) return null;

    await connection.execute('DELETE FROM workout_entries WHERE id = ?', [entry.id]);

    const [remaining] = await connection.execute(
      'SELECT COUNT(*) AS total FROM workout_entries WHERE workout_id = ?',
      [entry.workout_id],
    );

    if (Number(remaining[0]?.total ?? 0) === 0) {
      await connection.execute('DELETE FROM workouts WHERE id = ?', [entry.workout_id]);
    } else {
      await touchWorkout(connection, entry.workout_id);
    }

    return mapEntry(entry);
  });
}
