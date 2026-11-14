import * as exerciseApi from './exerciseApi.js';
import * as workoutStore from './workoutStore.js';
import { formatLongDate, todayISO } from '../lib/dates.js';
import { parseReps, volumeOf } from '../lib/reps.js';

function enrichEntry(entry) {
  const exercise = exerciseApi.getCachedExercise(entry.exerciseId);
  const repInfo = parseReps(entry.reps);

  return {
    ...entry,
    name: exercise?.name || entry.exerciseName || `Exercício #${entry.exerciseId}`,
    groups: exercise?.groups ?? [],
    repInfo,
    volume: Math.round(volumeOf(entry.reps, entry.weight) * 10) / 10,
  };
}

function summarize(entries) {
  const totals = entries.reduce(
    (accumulator, entry) => {
      accumulator.sets += entry.repInfo?.sets ?? 0;
      accumulator.reps += entry.repInfo?.totalReps ?? 0;
      accumulator.volume += entry.volume;
      return accumulator;
    },
    { sets: 0, reps: 0, volume: 0 },
  );

  return {
    total: entries.length,
    done: entries.filter((entry) => entry.done).length,
    sets: Math.round(totals.sets),
    reps: Math.round(totals.reps),
    volume: Math.round(totals.volume),
  };
}

/**
 * Dados básicos de um dia: registros enriquecidos (nome/grupos vindos do cache
 * da API) e totais usados nos cards do dashboard.
 */
export async function buildStatsView(date) {
  const day = await workoutStore.getDay(date);
  const entries = (day?.entries ?? []).map(enrichEntry);

  return {
    date,
    dateLabel: formatLongDate(date),
    isToday: date === todayISO(),
    entries,
    stats: summarize(entries),
    registeredIds: new Set(entries.map((entry) => entry.exerciseId)),
  };
}

/**
 * View completa do dashboard: dados do dia + catálogo filtrado/buscado na API.
 * Se a API estiver fora do ar, o dia continua funcionando e o catálogo mostra
 * um aviso com opção de tentar novamente.
 */
export async function buildDayView({ date, search = '', group = '' }) {
  let catalog = { exercises: [], groups: [], search: String(search ?? '').trim(), group: String(group ?? '').trim() };
  let catalogError = null;

  try {
    catalog = await exerciseApi.getCatalog({ search, group });
  } catch (error) {
    catalogError = error.message;
  }

  const statsView = await buildStatsView(date);

  return {
    ...statsView,
    exercises: catalog.exercises,
    groups: catalog.groups,
    filters: { search: catalog.search, group: catalog.group },
    catalogError,
  };
}
