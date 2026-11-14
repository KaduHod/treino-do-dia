import { config } from '../config.js';

/**
 * Cliente da API de exercícios.
 *
 * Contrato documentado (https://gymapi.kadu.tec.br/docs/index.html#/):
 *   GET {EXERCISES_API_URL}/exercises?Search=termo -> { data: ExerciseSimple[], metadata }
 *   GET {EXERCISES_API_URL}/exercises/:id          -> { data: Exercise, metadata }
 *   GET {EXERCISES_API_URL}/muscles/groups         -> { data: MuscleGroup[] } (com portions)
 *   GET {EXERCISES_API_URL}/muscles/portions       -> { data: MusclePortion[] }
 *   GET {EXERCISES_API_URL}/joints                 -> { data: Joint[] }
 *   GET {EXERCISES_API_URL}/movements              -> { data: Movement[] }
 *   GET {EXERCISES_API_URL}/muscles/movement-map   -> { data: MuscleMovementInfo[] }
 *
 * A lista simples não traz `mappings`, então os detalhes são consultados
 * sob demanda e cacheados em memória (TTL configurável) para montar os
 * filtros de grupo muscular e os badges da interface.
 */

const MAX_CACHE_ENTRIES = 1000;

const listCache = new Map();
const detailCache = new Map();
const groupsCache = new Map();
const referenceCache = new Map();

export class ExerciseApiError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ExerciseApiError';
    this.status = options.status ?? null;
  }
}

function readCache(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(cache, key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, expiresAt: Date.now() + config.exercisesCacheTtlMs });
  return value;
}

export function clearCache() {
  listCache.clear();
  detailCache.clear();
  groupsCache.clear();
  referenceCache.clear();
}

export function getCachedExercise(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return null;
  return readCache(detailCache, numericId);
}

export function groupsOf(exercise) {
  const mappings = Array.isArray(exercise?.mappings) ? exercise.mappings : [];
  return [...new Set(mappings.map((mapping) => mapping?.muscle_group).filter(Boolean))];
}

function requestHeaders() {
  const headers = { accept: 'application/json' };
  if (config.exercisesApiAuthHeader && config.exercisesApiAuthValue) {
    headers[config.exercisesApiAuthHeader] = config.exercisesApiAuthValue;
  }
  return headers;
}

/** A API responde no envelope { status, data, metadata } — aceita também payload cru. */
function unwrap(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

async function request(pathname, query = null) {
  const url = new URL(`${config.exercisesApiUrl}${pathname}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.exercisesApiTimeoutMs);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: requestHeaders(),
    });
  } catch (error) {
    const reason =
      error.name === 'AbortError'
        ? `tempo esgotado após ${config.exercisesApiTimeoutMs}ms`
        : error.message;
    throw new ExerciseApiError(
      `Não foi possível consultar a API de exercícios em ${config.exercisesApiUrl} (${reason}).`,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new ExerciseApiError('Exercício não encontrado na API.', { status: 404 });
    }
    throw new ExerciseApiError(`A API de exercícios respondeu com status ${response.status}.`, {
      status: response.status,
    });
  }

  try {
    return await response.json();
  } catch (error) {
    throw new ExerciseApiError('A API de exercícios retornou um JSON inválido.', { cause: error });
  }
}

function normalizeMapping(raw) {
  return {
    muscle_portion: String(raw?.muscle_portion ?? ''),
    muscle_group: String(raw?.muscle_group ?? ''),
    joint: String(raw?.joint ?? ''),
    movement: String(raw?.movement ?? ''),
    role: String(raw?.role ?? ''),
  };
}

function normalizeExercise(raw) {
  const id = Number(raw?.id);
  if (!Number.isInteger(id) || id <= 0) return null;

  const mappings = Array.isArray(raw?.mappings)
    ? raw.mappings.filter(Boolean).map(normalizeMapping)
    : [];

  const exercise = {
    id,
    name: String(raw.name ?? `Exercício #${id}`),
    description: String(raw.description ?? ''),
    info_link: raw.info_link ? String(raw.info_link) : '',
    mappings,
  };

  exercise.groups = groupsOf(exercise);
  return exercise;
}

function extractList(payload) {
  const data = unwrap(payload);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.exercises)) return data.exercises;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length || 1)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

async function hydrateList(summaries) {
  return mapWithConcurrency(summaries, config.exercisesApiConcurrency, async (summary) => {
    if (summary.mappings?.length) return summary;
    try {
      const detail = await getExercise(summary.id);
      return {
        ...summary,
        ...detail,
        description: detail.description || summary.description,
        info_link: detail.info_link || summary.info_link,
      };
    } catch {
      // Detalhe indisponível: mantém o item da lista, apenas sem mappings/grupos.
      return summary;
    }
  });
}

export async function listExercises(search = '') {
  const term = String(search ?? '').trim();
  const key = term.toLowerCase();
  const cached = readCache(listCache, key);
  if (cached) return cached;

  const payload = await request('/exercises', {
    [config.exercisesApiSearchParam]: term,
  });
  const list = extractList(payload).map(normalizeExercise).filter(Boolean);
  return writeCache(listCache, key, list);
}

export async function getExercise(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new ExerciseApiError('Identificador de exercício inválido.', { status: 400 });
  }

  const cached = readCache(detailCache, numericId);
  if (cached) return cached;

  const payload = unwrap(await request(`/exercises/${numericId}`));
  const exercise = normalizeExercise(payload);
  if (!exercise) {
    throw new ExerciseApiError('A API retornou um exercício sem id válido.');
  }

  return writeCache(detailCache, exercise.id, exercise);
}

function groupNames(names) {
  return [...new Set(names.map((name) => String(name ?? '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
}

async function deriveGroupsFromExercises() {
  const all = await hydrateList(await listExercises(''));
  return groupNames(all.flatMap((exercise) => exercise.groups ?? []));
}

function groupKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

function portionLabel(raw) {
  return (typeof raw === 'string' ? raw : String(raw?.name ?? '')).trim();
}

function addPortion(group, raw) {
  const name = portionLabel(raw);
  if (!group || !name) return;

  const key = groupKey(name);
  if (!group.portions.has(key)) group.portions.set(key, name);
}

/**
 * Combina /muscles/groups com /muscles/portions.
 *
 * Algumas respostas de /muscles/groups não trazem `portions` preenchidas (ou
 * trazem apenas parte delas); nesse caso as porções vêm da lista plana de
 * /muscles/portions, ligadas pelo `muscle_group_id`.
 */
function buildReferenceGroups(rawGroups, rawPortions) {
  const groups = [];
  const byId = new Map();
  const byName = new Map();

  for (const raw of rawGroups) {
    const name = String(raw?.name ?? '').trim();
    if (!name || byName.has(groupKey(name))) continue;

    const id = Number(raw?.id);
    const group = {
      id: Number.isInteger(id) && id > 0 ? id : null,
      name,
      portions: new Map(),
    };

    groups.push(group);
    byName.set(groupKey(name), group);
    if (group.id !== null) byId.set(group.id, group);

    if (Array.isArray(raw?.portions)) {
      for (const portion of raw.portions) addPortion(group, portion);
    }
  }

  for (const raw of rawPortions) {
    const groupId = Number(raw?.muscle_group_id);
    if (!Number.isInteger(groupId) || groupId <= 0) continue;
    addPortion(byId.get(groupId), raw);
  }

  return groups
    .map((group) => ({
      name: group.name,
      portions: [...group.portions.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function sortedNames(payload) {
  return groupNames(extractList(payload).map((item) => item?.name));
}

/**
 * Registros de referência disponibilizados pela API: grupos musculares (com
 * porções), articulações e movimentos. Usado no modal "Referência muscular".
 */
export async function getReference() {
  const cached = readCache(referenceCache, 'reference');
  if (cached) return cached;

  const [groupsResult, portionsResult, jointsResult, movementsResult] = await Promise.allSettled([
    request('/muscles/groups'),
    request('/muscles/portions'),
    request('/joints'),
    request('/movements'),
  ]);

  let groups = buildReferenceGroups(
    groupsResult.status === 'fulfilled' ? extractList(groupsResult.value) : [],
    portionsResult.status === 'fulfilled' ? extractList(portionsResult.value) : [],
  );

  if (!groups.length) {
    const names = await listMuscleGroups().catch(() => []);
    groups = names.map((name) => ({ name, portions: [] }));
  }

  // Nenhum endpoint respondeu (e não há como derivar grupos): propaga o erro
  // para o modal exibir o aviso em vez de uma referência vazia.
  const results = [groupsResult, portionsResult, jointsResult, movementsResult];
  if (!groups.length && results.every((result) => result.status === 'rejected')) {
    throw groupsResult.reason ?? portionsResult.reason ?? new Error('Referência muscular indisponível.');
  }

  return writeCache(referenceCache, 'reference', {
    groups,
    joints: jointsResult.status === 'fulfilled' ? sortedNames(jointsResult.value) : [],
    movements: movementsResult.status === 'fulfilled' ? sortedNames(movementsResult.value) : [],
    portionCount: groups.reduce((total, group) => total + group.portions.length, 0),
  });
}

export async function listMuscleGroups() {
  const cached = readCache(groupsCache, 'groups');
  if (cached) return cached;

  let names = [];
  try {
    names = groupNames(extractList(await request('/muscles/groups')).map((group) => group?.name));
  } catch {
    // Endpoint de grupos indisponível: deriva os grupos a partir dos exercícios.
  }

  return writeCache(groupsCache, 'groups', names.length ? names : await deriveGroupsFromExercises());
}

export async function getCatalog({ search = '', group = '' } = {}) {
  const term = String(search ?? '').trim();
  const groupFilter = String(group ?? '').trim();

  const [summaries, groups] = await Promise.all([listExercises(term), listMuscleGroups()]);
  const detailed = await hydrateList(summaries);
  const exercises = groupFilter
    ? detailed.filter((exercise) =>
        (exercise.groups ?? []).some((name) => name.toLowerCase() === groupFilter.toLowerCase()),
      )
    : detailed;

  return { exercises, groups, search: term, group: groupFilter };
}
