import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { normalizeDate } from '../lib/dates.js';
import { buildDayView } from '../services/dashboard.js';
import { getReference } from '../services/exerciseApi.js';

const router = Router();

function catalogFilters(query) {
  return {
    search: typeof query.search === 'string' ? query.search : '',
    group: typeof query.group === 'string' ? query.group : '',
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const date = normalizeDate(req.query.date);
    const view = await buildDayView({ date, ...catalogFilters(req.query) });
    res.render('index', { view });
  }),
);

router.get(
  '/day',
  asyncHandler(async (req, res) => {
    const date = normalizeDate(req.query.date);
    const view = await buildDayView({ date, ...catalogFilters(req.query) });
    res.render('partials/content', { view });
  }),
);

/**
 * Referência muscular (grupos com porções, articulações e movimentos)
 * direto dos endpoints /muscles/groups, /joints e /movements da API.
 * Alvo: <dialog id="reference-modal"> (innerHTML).
 */
router.get(
  '/reference',
  asyncHandler(async (req, res) => {
    try {
      const reference = await getReference();
      res.render('partials/reference', { reference, error: null });
    } catch (error) {
      res.render('partials/reference', { reference: null, error: error.message });
    }
  }),
);

export default router;
