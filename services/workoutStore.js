import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Persistência local dos treinos em data/workouts.json.
 *
 * Formato do arquivo:
 * {
 *   "2026-11-13": {
 *     "date": "2026-11-13",
 *     "entries": [
 *       {
 *         "exerciseId": 88,
 *         "exerciseName": "Supino Reto",
 *         "reps": "3x12",
 *         "weight": 40,
 *         "done": true,
 *         "createdAt": "...",
 *         "updatedAt": "..."
 *       }
 *     ],
 *     "createdAt": "...",
 *     "updatedAt": "..."
 *   }
 * }
 */

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'workouts.json');

let writeQueue = Promise.resolve();

async function readDatabase() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) {
      throw new Error(`Arquivo de dados inválido (${DATA_FILE}): ${error.message}`);
    }
    throw error;
  }
}

async function writeDatabase(database) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryFile, DATA_FILE);
}

function normalizeEntry(raw) {
  const exerciseId = Number(raw?.exerciseId);
  if (!Number.isInteger(exerciseId) || exerciseId <= 0) return null;

  const weight = Number(raw?.weight);

  return {
    exerciseId,
    exerciseName: String(raw?.exerciseName ?? ''),
    reps: String(raw?.reps ?? ''),
    weight: Number.isFinite(weight) && weight >= 0 ? weight : 0,
    done: Boolean(raw?.done),
    createdAt: raw?.createdAt ?? null,
    updatedAt: raw?.updatedAt ?? null,
  };
}

function normalizeDay(raw, date) {
  const entries = Array.isArray(raw?.entries)
    ? raw.entries.map(normalizeEntry).filter(Boolean)
    : [];

  return {
    date,
    entries,
    createdAt: raw?.createdAt ?? null,
    updatedAt: raw?.updatedAt ?? null,
  };
}

function enqueue(task) {
  const result = writeQueue.then(task, task);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function mutateDay(date, mutator) {
  return enqueue(async () => {
    const database = await readDatabase();
    const existing = database[date] ? normalizeDay(database[date], date) : null;
    const now = new Date().toISOString();
    const day = {
      date,
      entries: existing ? [...existing.entries] : [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const result = mutator(day);

    day.updatedAt = new Date().toISOString();
    if (day.entries.length > 0) {
      database[date] = day;
    } else {
      delete database[date];
    }
    await writeDatabase(database);

    return result;
  });
}

export async function getDay(date) {
  const database = await readDatabase();
  const raw = database[date];
  return raw ? normalizeDay(raw, date) : null;
}

export function addEntry(date, { exerciseId, exerciseName = '', reps = '3x12', weight = 0, done = true }) {
  return mutateDay(date, (day) => {
    const now = new Date().toISOString();
    const existing = day.entries.find((entry) => entry.exerciseId === exerciseId);

    if (existing) {
      if (exerciseName) existing.exerciseName = exerciseName;
      existing.updatedAt = now;
      return existing;
    }

    const entry = {
      exerciseId,
      exerciseName,
      reps: String(reps),
      weight: Number.isFinite(Number(weight)) && Number(weight) >= 0 ? Number(weight) : 0,
      done: Boolean(done),
      createdAt: now,
      updatedAt: now,
    };

    day.entries.push(entry);
    return entry;
  });
}

export function updateEntry(date, exerciseId, changes) {
  return mutateDay(date, (day) => {
    const index = day.entries.findIndex((entry) => entry.exerciseId === exerciseId);
    if (index === -1) {
      const error = new Error('Registro não encontrado neste dia.');
      error.code = 'ENTRY_NOT_FOUND';
      throw error;
    }

    const next = { ...day.entries[index], updatedAt: new Date().toISOString() };
    if (changes.reps !== undefined) next.reps = changes.reps;
    if (changes.weight !== undefined) next.weight = changes.weight;
    if (changes.done !== undefined) next.done = changes.done;

    day.entries[index] = next;
    return next;
  });
}

export function removeEntry(date, exerciseId) {
  return mutateDay(date, (day) => {
    const index = day.entries.findIndex((entry) => entry.exerciseId === exerciseId);
    if (index === -1) return null;
    return day.entries.splice(index, 1)[0];
  });
}
