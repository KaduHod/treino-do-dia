function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: numberFromEnv(process.env.PORT, 3000),
  // Em produção: https://gymapi.kadu.tec.br/api/v1 (ver docs/index.html da API).
  exercisesApiUrl: (process.env.EXERCISES_API_URL || 'http://localhost:3055/api/v1').replace(/\/+$/, ''),
  // A API real usa o parâmetro "Search" (FULL TEXT do MySQL).
  exercisesApiSearchParam: process.env.EXERCISES_API_SEARCH_PARAM || 'Search',
  // Enquanto a API de produção não é liberada, o mock local não exige autenticação.
  exercisesApiAuthHeader: process.env.EXERCISES_API_AUTH_HEADER || '',
  exercisesApiAuthValue: process.env.EXERCISES_API_AUTH_VALUE || '',
  exercisesApiTimeoutMs: numberFromEnv(process.env.EXERCISES_API_TIMEOUT_MS, 5000),
  exercisesCacheTtlMs: numberFromEnv(process.env.EXERCISES_API_CACHE_TTL_MS, 60000),
  exercisesApiConcurrency: numberFromEnv(process.env.EXERCISES_API_CONCURRENCY, 6),
  database: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: numberFromEnv(process.env.MYSQL_PORT, 3306),
    user: process.env.MYSQL_USER || 'treino',
    password: process.env.MYSQL_PASSWORD || 'treino_dev',
    name: process.env.MYSQL_DATABASE || 'treino',
    connectionLimit: numberFromEnv(process.env.MYSQL_CONNECTION_LIMIT, 10),
    // Enquanto não existe login, todos os treinos pertencem a este usuário
    // (seed "default" criado por db/init/02-seed.sql).
    defaultUserId: numberFromEnv(process.env.DEFAULT_USER_ID, 1),
  },
};
