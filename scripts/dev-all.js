/**
 * Sobe o mock da API de exercícios (porta 3005 por padrão) e o app (porta 3000)
 * juntos, apontando o app para o mock — mesmo quando MOCK_API_PORT é alterado.
 * Uso: npm run dev:all
 *      MOCK_API_PORT=3105 npm run dev:all
 */
import { spawn } from 'node:child_process';

const mockPort = Number(process.env.MOCK_API_PORT) || 3055;
const mockUrl = `http://localhost:${mockPort}/api/v1`;

const children = [
  spawn(process.execPath, ['mock-api/server.js'], {
    stdio: 'inherit',
    env: { ...process.env, MOCK_API_PORT: String(mockPort) },
  }),
  spawn(process.execPath, ['--watch', 'server.js'], {
    stdio: 'inherit',
    env: { ...process.env, EXERCISES_API_URL: process.env.EXERCISES_API_URL || mockUrl },
  }),
];

let shuttingDown = false;

function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }

  setTimeout(() => process.exit(0), 300).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}

for (const child of children) {
  child.on('exit', (code) => {
    if (shuttingDown) return;
    process.exitCode = code ?? 0;
    shutdown();
  });
}
