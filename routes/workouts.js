import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { isValidISODate } from '../lib/dates.js';
import { buildStatsView } from '../services/dashboard.js';
import { getCachedExercise, getExercise } from '../services/exerciseApi.js';
import { addEntry, getDay, removeEntry, updateEntry } from '../services/workoutStore.js';

const router = Router();

const MAX_REPS_LENGTH = 24;
const MAX_WEIGHT_KG = 1000;

function mutationDate(req, res) {
  const { date } = req.params;
  if (!isValidISODate(date)) {
    res.status(400).send('Data inválida.');
    return null;
  }
  return date;
}

function parseExerciseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Adiciona um exercício ao treino do dia.
 * Alvo: #day-panel (outerHTML) + item do catálogo via hx-swap-oob.
 */
router.post(
  '/:date/entries',
  asyncHandler(async (req, res) => {
    const date = mutationDate(req, res);
    if (!date) return;

    const exerciseId = parseExerciseId(req.body.exerciseId);
    if (!exerciseId) return res.status(400).send('exerciseId inválido.');

    let exercise = getCachedExercise(exerciseId);
    if (!exercise) {
      try {
        exercise = await getExercise(exerciseId);
      } catch (error) {
        return res.status(502).send(error.message);
      }
    }

    await addEntry(date, {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      reps: '3x12',
      weight: 0,
      done: true,
    });

    const view = await buildStatsView(date);
    res.render('partials/day-mutation', { view, oobExercise: exercise });
  }),
);

/**
 * Atualiza reps, carga e o checkbox "feito" de um registro.
 * Alvo: o próprio formulário da linha (outerHTML) + cards de estatísticas via OOB.
 */
router.patch(
  '/:date/entries/:exerciseId',
  asyncHandler(async (req, res) => {
    const date = mutationDate(req, res);
    if (!date) return;

    const exerciseId = parseExerciseId(req.params.exerciseId);
    if (!exerciseId) return res.status(400).send('exerciseId inválido.');

    const day = await getDay(date);
    const current = day?.entries.find((entry) => entry.exerciseId === exerciseId);
    if (!current) return res.status(404).send('Registro não encontrado neste dia.');

    const reps = String(req.body.reps ?? '').trim().slice(0, MAX_REPS_LENGTH);
    const weightRaw = String(req.body.weight ?? '').replace(',', '.').trim();
    const weight = Number(weightRaw);
    const done = ['true', 'on', '1'].includes(String(req.body.done ?? '').toLowerCase());

    let error = null;
    if (!reps) {
      error = 'Informe as repetições (ex: 3x12).';
    } else if (!weightRaw || !Number.isFinite(weight) || weight < 0 || weight > MAX_WEIGHT_KG) {
      error = `Informe a carga em kg (0 a ${MAX_WEIGHT_KG}).`;
    }

    if (!error) {
      try {
        await updateEntry(date, exerciseId, { reps, weight, done });
      } catch (updateError) {
        if (updateError.code === 'ENTRY_NOT_FOUND') {
          return res.status(404).send(updateError.message);
        }
        throw updateError;
      }
    }

    const view = await buildStatsView(date);
    const entry = view.entries.find((item) => item.exerciseId === exerciseId);

    res.render('partials/entry-response', {
      view,
      entry,
      error,
      justSaved: !error,
    });
  }),
);

/**
 * Remove um exercício do treino do dia.
 * Alvo: #day-panel (outerHTML) + item do catálogo via hx-swap-oob.
 */
router.delete(
  '/:date/entries/:exerciseId',
  asyncHandler(async (req, res) => {
    const date = mutationDate(req, res);
    if (!date) return;

    const exerciseId = parseExerciseId(req.params.exerciseId);
    if (!exerciseId) return res.status(400).send('exerciseId inválido.');

    const removed = await removeEntry(date, exerciseId);
    const view = await buildStatsView(date);

    const exercise = getCachedExercise(exerciseId) ?? {
      id: exerciseId,
      name: removed?.exerciseName || `Exercício #${exerciseId}`,
      description: '',
      info_link: '',
      mappings: [],
      groups: [],
    };

    res.render('partials/day-mutation', { view, oobExercise: exercise });
  }),
);

export default router;
