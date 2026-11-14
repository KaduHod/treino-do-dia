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
};
