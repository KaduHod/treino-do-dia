import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { asyncHandler } from './lib/asyncHandler.js';
import { roleLabel } from './lib/labels.js';
import pagesRouter from './routes/pages.js';
import exercisesRouter from './routes/exercises.js';
import workoutsRouter from './routes/workouts.js';
import { closePool, pingDatabase } from './services/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.locals.apiBaseUrl = config.exercisesApiUrl;
app.locals.roleLabel = roleLabel;
app.locals.formatNumber = (value) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(value) || 0);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use('/', pagesRouter);
app.use('/exercises', exercisesRouter);
app.use('/workouts', workoutsRouter);

app.get(
  '/health',
  asyncHandler(async (req, res) => {
    let database = 'up';
    try {
      await pingDatabase();
    } catch {
      database = 'down';
    }

    const ok = database === 'up';
    res.status(ok ? 200 : 503).json({
      ok,
      database,
      exercisesApiUrl: config.exercisesApiUrl,
    });
  }),
);

app.use((req, res) => {
  res.status(404).send('Página não encontrada.');
});

app.use((error, req, res, next) => {
  console.error('[treino] erro:', error);

  if (res.headersSent) return next(error);

  const isHtmx = req.get('HX-Request') === 'true';
  const message = error.message || 'Erro interno no servidor.';

  if (isHtmx) {
    return res.status(500).send(message);
  }

  res.status(500).send(`Erro interno: ${message}`);
});

const server = app.listen(config.port, () => {
  console.log(`[treino] app em http://localhost:${config.port}`);
  console.log(`[treino] API de exercícios: ${config.exercisesApiUrl}`);
  console.log(
    `[treino] MySQL: ${config.database.user}@${config.database.host}:${config.database.port}/${config.database.name}`,
  );
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[treino] ${signal} recebido, encerrando...`);

  server.close(async () => {
    await closePool().catch(() => undefined);
    process.exit(0);
  });

  // Não deixa o processo preso se alguma conexão HTTP não fechar.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
