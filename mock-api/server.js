/**
 * Mock da API de exercícios (porta 3005), usado apenas em desenvolvimento.
 *
 * Reproduz o contrato documentado em https://gymapi.kadu.tec.br/docs/index.html#/:
 *   GET /api/v1/exercises?Search=termo -> { status, data: ExerciseSimple[], metadata }
 *   GET /api/v1/exercises/:id          -> { status, data: Exercise, metadata }
 *   GET /api/v1/muscles/groups         -> MuscleGroup[] (com portions)
 *   GET /api/v1/muscles                -> mesmo conteúdo de /muscles/groups
 *   GET /api/v1/muscles/portions       -> MusclePortion[]
 *   GET /api/v1/muscles/movement-map   -> MuscleMovementInfo[] (filtros por query)
 *   GET /api/v1/joints                 -> Articulações
 *   GET /api/v1/movements              -> Movimentos
 *
 * A busca simula o FULL TEXT do MySQL: todos os termos precisam aparecer no
 * nome, descrição ou mapeamento muscular do exercício.
 */
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'exercises.json');
const PORT = Number(process.env.MOCK_API_PORT || 3055);
const LATENCY_MS = Number(process.env.MOCK_API_LATENCY_MS || 0);

const app = express();

let exercisesPromise;

async function loadExercises() {
  if (!exercisesPromise) {
    exercisesPromise = fs.readFile(DATA_FILE, 'utf8').then((raw) => JSON.parse(raw));
  }
  return exercisesPromise;
}

function delay() {
  return LATENCY_MS > 0 ? new Promise((resolve) => setTimeout(resolve, LATENCY_MS)) : Promise.resolve();
}

function envelope(data) {
  const total = Array.isArray(data) ? data.length : data ? 1 : 0;
  return { status: 'success', data, metadata: { total_itens: total } };
}

function byName(a, b) {
  return a.name.localeCompare(b.name, 'pt-BR');
}

/**
 * Deriva os registros "de referência" (grupos, porções, articulações e
 * movimentos) a partir dos mappings dos exercícios. Na API real esses dados
 * vêm de tabelas próprias; aqui são reconstruídos do JSON do mock.
 */
function buildReference(exercises) {
  const groups = new Map();
  const joints = new Map();
  const movements = new Map();
  const movementMap = [];
  const seenMappings = new Set();
  let portionSeq = 0;

  const idIn = (map, name) => {
    if (!map.has(name)) map.set(name, map.size + 1);
    return map.get(name);
  };

  for (const exercise of exercises) {
    for (const mapping of exercise.mappings ?? []) {
      const groupName = String(mapping.muscle_group ?? '').trim();
      const portionName = String(mapping.muscle_portion ?? '').trim();
      const jointName = String(mapping.joint ?? '').trim();
      const movementName = String(mapping.movement ?? '').trim();

      if (groupName) {
        if (!groups.has(groupName)) {
          groups.set(groupName, { id: groups.size + 1, name: groupName, portions: new Map() });
        }
        const group = groups.get(groupName);
        if (portionName && !group.portions.has(portionName)) {
          group.portions.set(portionName, {
            id: ++portionSeq,
            muscle_group_id: group.id,
            name: portionName,
          });
        }
      }

      if (jointName) idIn(joints, jointName);
      if (movementName) idIn(movements, movementName);

      const key = [groupName, portionName, jointName, movementName].join('|').toLowerCase();
      if (key !== '|||' && !seenMappings.has(key)) {
        seenMappings.add(key);
        movementMap.push({
          muscle_group_name: groupName,
          muscle_portion_name: portionName,
          joint_name: jointName,
          movement_name: movementName,
        });
      }
    }
  }

  const listFrom = (map) => [...map.entries()].map(([name, id]) => ({ id, name })).sort(byName);

  const muscleGroups = [...groups.values()]
    .map((group) => ({ id: group.id, name: group.name, portions: [...group.portions.values()].sort(byName) }))
    .sort(byName);

  return {
    groups: muscleGroups,
    portions: muscleGroups.flatMap((group) => group.portions).sort(byName),
    joints: listFrom(joints),
    movements: listFrom(movements),
    movementMap,
  };
}

let referencePromise;

function loadReference() {
  if (!referencePromise) referencePromise = loadExercises().then(buildReference);
  return referencePromise;
}

function toSummary(exercise) {
  return {
    id: exercise.id,
    name: exercise.name,
    description: exercise.description,
    info_link: exercise.info_link,
  };
}

function haystack(exercise) {
  const mappings = Array.isArray(exercise.mappings) ? exercise.mappings : [];
  return [
    exercise.name,
    exercise.description,
    ...mappings.flatMap((mapping) => [
      mapping.muscle_portion,
      mapping.muscle_group,
      mapping.joint,
      mapping.movement,
      mapping.role,
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function search(exercises, term) {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return exercises;

  const terms = normalized.split(/\s+/).filter(Boolean);
  const scored = [];

  for (const exercise of exercises) {
    const text = haystack(exercise);
    if (!terms.every((word) => text.includes(word))) continue;

    // Nome tem prioridade, depois descrição (aproximação do relevance do MySQL).
    const inName = exercise.name.toLowerCase().includes(normalized) ? 0 : 1;
    const nameWordHits = terms.filter((word) => exercise.name.toLowerCase().includes(word)).length;
    scored.push({ exercise, score: inName * 100 - nameWordHits });
  }

  return scored.sort((a, b) => a.score - b.score).map((item) => item.exercise);
}

function matchesQuery(row, field, value) {
  const filter = String(value ?? '').trim().toLowerCase();
  return !filter || String(row[field] ?? '').toLowerCase().includes(filter);
}

app.get('/api/v1/exercises', async (req, res, next) => {
  try {
    const term = String(req.query.Search ?? req.query.search ?? req.query.q ?? '');
    const exercises = await loadExercises();
    await delay();
    res.json(envelope(search(exercises, term).map(toSummary)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/exercises/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: 'error', message: 'id inválido' });
    }

    const exercises = await loadExercises();
    await delay();
    const exercise = exercises.find((item) => item.id === id);

    if (!exercise) {
      return res.status(404).json({ status: 'error', message: 'exercício não encontrado' });
    }

    res.json(envelope(exercise));
  } catch (error) {
    next(error);
  }
});

async function sendReference(res, next, selector) {
  try {
    const reference = await loadReference();
    await delay();
    res.json(envelope(selector(reference)));
  } catch (error) {
    next(error);
  }
}

app.get('/api/v1/muscles/groups', (req, res, next) =>
  sendReference(res, next, (reference) => reference.groups),
);

app.get('/api/v1/muscles', (req, res, next) =>
  sendReference(res, next, (reference) => reference.groups),
);

app.get('/api/v1/muscles/portions', (req, res, next) =>
  sendReference(res, next, (reference) => reference.portions),
);

app.get('/api/v1/joints', (req, res, next) =>
  sendReference(res, next, (reference) => reference.joints),
);

app.get('/api/v1/movements', (req, res, next) =>
  sendReference(res, next, (reference) => reference.movements),
);

app.get('/api/v1/muscles/movement-map', async (req, res, next) => {
  try {
    const { movementMap } = await loadReference();
    await delay();

    const rows = movementMap.filter(
      (row) =>
        matchesQuery(row, 'muscle_group_name', req.query.muscle_group) &&
        matchesQuery(row, 'muscle_portion_name', req.query.muscle_portion) &&
        matchesQuery(row, 'joint_name', req.query.joint) &&
        matchesQuery(row, 'movement_name', req.query.movement),
    );

    res.json(envelope(rows));
  } catch (error) {
    next(error);
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'mock-exercises-api' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'rota não encontrada' });
});

app.use((error, req, res, next) => {
  console.error('[mock-api] erro:', error);
  res.status(500).json({ error: 'erro interno no mock da API' });
});

app.listen(PORT, () => {
  console.log(`[mock-api] API de exercícios em http://localhost:${PORT}/api/v1/exercises`);
});
