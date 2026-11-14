import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { normalizeDate } from '../lib/dates.js';
import { buildDayView, buildStatsView } from '../services/dashboard.js';
import { getExercise } from '../services/exerciseApi.js';

const router = Router();

/**
 * Lista de exercícios para o HTMX (busca + filtro por grupo muscular).
 * Alvo: #exercise-list (outerHTML).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const date = normalizeDate(req.query.date);
    const view = await buildDayView({
      date,
      search: typeof req.query.search === 'string' ? req.query.search : '',
      group: typeof req.query.group === 'string' ? req.query.group : '',
    });
    res.render('partials/exercise-list', { view });
  }),
);

/**
 * Detalhes de um exercício (descrição + mappings) para o modal.
 * Alvo: <dialog id="exercise-modal"> (innerHTML).
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const date = normalizeDate(req.query.date);
    const exerciseId = Number(req.params.id);
    const view = await buildStatsView(date);

    if (!Number.isInteger(exerciseId) || exerciseId <= 0) {
      return res.render('partials/exercise-detail-error', {
        view,
        exerciseId,
        message: 'Identificador de exercício inválido.',
      });
    }

    try {
      const exercise = await getExercise(exerciseId);
      res.render('partials/exercise-detail', {
        view,
        exercise,
        registered: view.registeredIds.has(exercise.id),
      });
    } catch (error) {
      res.render('partials/exercise-detail-error', {
        view,
        exerciseId,
        message: error.message,
      });
    }
  }),
);

export default router;
