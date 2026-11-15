# Treino do Dia

Workout tracker minimalista para uso pessoal: selecione um dia, busque exercícios na API,
registre séries/repetições/carga e marque o que foi feito. Os treinos são persistidos no
MySQL 8.4 (`db/`); enquanto não há login, tudo pertence ao usuário `default` (id `1`). O
antigo `data/workouts.json` pode ser migrado com `npm run db:import`.

- **Backend:** Node.js (ES Modules) + Express + EJS + MySQL (`mysql2`)
- **Frontend:** Tailwind CSS (CDN) + HTMX 2 (CDN), sem build step
- **Dados de treino:** MySQL 8.4 (`users` → `workouts` → `workout_entries`)
- **Exercícios:** API externa (mock local durante o desenvolvimento)

## Como rodar (com o mock da API)

```bash
docker compose up -d db   # MySQL em localhost:${DB_PORT:-3307}
npm install
npm run db:import         # opcional: migra o data/workouts.json antigo

# opção 1: mock + app no mesmo terminal
npm run dev:all

# opção 2: dois terminais
npm run dev:mock          # mock em http://localhost:3005/api/v1
npm run dev               # app em http://localhost:3000
```

Abra <http://localhost:3000>. O `.env` já aponta `MYSQL_HOST=127.0.0.1` e `MYSQL_PORT=3307`
(porta publicada pelo compose); dentro do compose o app recebe `MYSQL_HOST=db` e
`MYSQL_PORT=3306`.

> O mock é só para desenvolvimento. Ele reproduz o contrato documentado da API real
> (`https://gymapi.kadu.tec.br/docs/index.html#/`), mas os dados ficam em
> `mock-api/data/exercises.json`. Nada de produção é consumido ainda.

Se a porta `3005` já estiver ocupada na sua máquina (por exemplo, pela própria GymAPI
rodando localmente), use outra porta — `dev:all` já aponta o app para o mock escolhido:

```bash
MOCK_API_PORT=3105 npm run dev:all
```

Ou, em dois terminais:

```bash
MOCK_API_PORT=3105 npm run dev:mock
EXERCISES_API_URL=http://localhost:3105/api/v1 npm run dev
```

## Docker

A imagem é multi-stage (`node:22-alpine`), roda como usuário `node` (não-root), expõe a
porta `3000` e tem `HEALTHCHECK` batendo em `/health` (que também verifica a conexão com o
MySQL). O app não grava arquivos: os treinos ficam no volume `mysql-data` do serviço `db`.

### Só o app

```bash
docker build -t treino-do-dia .
docker run --rm -p 3000:3000 \
  -e EXERCISES_API_URL=https://gymapi.kadu.tec.br/api/v1 \
  -e MYSQL_HOST=SEU_HOST \
  -e MYSQL_PORT=3306 \
  -e MYSQL_DATABASE=treino \
  -e MYSQL_USER=treino \
  -e MYSQL_PASSWORD=treino_dev \
  treino-do-dia
```

> O banco precisa existir e ter o schema de `db/init/01-schema.sql` (o serviço `db` do
> compose aplica no primeiro boot). Sem `EXERCISES_API_URL` o padrão é
> `http://localhost:3055/api/v1`, que dentro do container não existe: o catálogo mostraria
> o erro da API (o painel do dia continua funcionando). Use o compose abaixo para subir
> junto com o mock e o banco.

### App + mock + MySQL (compose)

```bash
docker compose up --build
```

- App em <http://localhost:3000>; o catálogo consulta o serviço `mock`
  (`http://mock:3055/api/v1`, sem porta publicada no host).
- Outra porta no host: `APP_PORT=8080 docker compose up`.
- API real: `APP_EXERCISES_API_URL=https://gymapi.kadu.tec.br/api/v1 docker compose up -d app`.
- O compose interpola as variáveis do `.env` local (`EXERCISES_API_AUTH_*`, timeouts,
  cache etc.). A exceção proposital é `EXERCISES_API_URL` do `.env`, que não é usada:
  dentro do container `localhost` é o próprio app — o override é `APP_EXERCISES_API_URL`.
- Os treinos ficam no volume `mysql-data`. Para consultar:

```bash
docker compose exec db mysql -utreino -ptreino_dev treino \
  -e "SELECT w.workout_date, e.exercise_name, e.reps, e.weight_kg, e.done
        FROM workout_entries e JOIN workouts w ON w.id = e.workout_id
       ORDER BY w.workout_date, e.id;"
```

- O antigo volume `workouts-data` não é mais montado. Se ele existir, importe o JSON:

```bash
docker run --rm -v treino-do-dia_workouts-data:/data alpine cat /data/workouts.json > /tmp/workouts.json
npm run db:import -- --file /tmp/workouts.json
```

### Banco de dados (MySQL)

A estrutura do banco fica em `db/`:

| Arquivo | Conteúdo |
| --- | --- |
| `db/Dockerfile` | MySQL 8.4 LTS + `my.cnf` + scripts de inicialização |
| `db/my.cnf` | `utf8mb4`, timestamps em UTC e `skip-name-resolve` |
| `db/init/01-schema.sql` | Tabelas `users`, `workouts` e `workout_entries` |
| `db/init/02-seed.sql` | Usuário `default` (id `1`) do modo single-user |

O compose sobe o serviço `db` com o volume nomeado `mysql-data`; os scripts em
`db/init/` rodam **somente no primeiro boot**, quando o volume está vazio.

```bash
# Sobe apenas o banco e mostra as tabelas criadas
docker compose up -d db
docker compose exec db mysql -utreino -ptreino_dev treino -e "SHOW TABLES;"

# Recriar do zero (APAGA os dados do volume)
docker compose down -v
docker compose up -d db
```

- No host o banco fica em `localhost:${DB_PORT:-3307}` (o padrão é `3307` porque `3306`
  costuma estar ocupada). Dentro do compose o app acessa `db:3306`.
- Credenciais de desenvolvimento: banco `treino`, usuário `treino`, senha `treino_dev`
  (root: `root_dev`). Em produção, defina `MYSQL_*` no ambiente do compose.
- Modelo de dados (um usuário → vários dias → vários exercícios):

| Tabela | Papel | Equivalente no JSON |
| --- | --- | --- |
| `users` | dono dos treinos; base para o futuro login | — |
| `workouts` | um dia por usuário (`user_id`, `workout_date`) | `workouts.json[date]` |
| `workout_entries` | exercícios do dia (`exercise_id`, `reps`, `weight_kg`, `done`) | `entries[]` |

O app grava direto nessas tabelas: `services/workoutStore.js` usa o pool de
`services/db.js` e o `DEFAULT_USER_ID` (padrão `1`). O `/health` executa `SELECT 1` e
retorna `503` se o banco estiver fora do ar.

### Importar o JSON antigo

```bash
npm run db:import                          # lê data/workouts.json
npm run db:import -- --file outro.json     # ou WORKOUTS_JSON_PATH=...
```

O script roda em transação, é idempotente (upsert por dia/exercício) e, quando o mesmo
registro aparece em arquivos diferentes, mantém o `updatedAt` mais recente. Ele **não**
apaga dados que existam só no banco. Execute-o na máquina host (o diretório `scripts/` não
é copiado para a imagem).

## Variáveis de ambiente

Copie `.env.example` para `.env` e ajuste os valores. `npm start`/`npm run dev` carregam o
arquivo via `node --env-file=.env`; no Docker as variáveis vêm do compose.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta do app |
| `EXERCISES_API_URL` | `http://localhost:3005/api/v1` | Base da API de exercícios |
| `EXERCISES_API_SEARCH_PARAM` | `Search` | Nome do parâmetro de busca (FULL TEXT) |
| `EXERCISES_API_AUTH_HEADER` | — | Header de autenticação (ex.: `Authorization`) |
| `EXERCISES_API_AUTH_VALUE` | — | Valor do header (ex.: `Bearer TOKEN`) |
| `EXERCISES_API_TIMEOUT_MS` | `5000` | Timeout por chamada |
| `EXERCISES_API_CACHE_TTL_MS` | `60000` | TTL do cache em memória |
| `EXERCISES_API_CONCURRENCY` | `6` | Detalhes buscados em paralelo |
| `MOCK_API_PORT` | `3005` | Porta do mock |
| `MOCK_API_LATENCY_MS` | `0` | Latência artificial do mock |
| `MYSQL_HOST` | `localhost` | Host do MySQL (no compose o app recebe `db`) |
| `MYSQL_PORT` | `3306` | Porta do MySQL (no host via compose: `3307`) |
| `MYSQL_DATABASE` | `treino` | Nome do banco |
| `MYSQL_USER` | `treino` | Usuário do banco |
| `MYSQL_PASSWORD` | `treino_dev` | Senha do banco (troque em produção) |
| `MYSQL_CONNECTION_LIMIT` | `10` | Conexões do pool |
| `DEFAULT_USER_ID` | `1` | Dono dos treinos enquanto não há login (precisa existir em `users`; o seed cria o id `1`) |
| `DB_PORT` | `3307` | Porta publicada pelo serviço `db` no host |

## Contrato da API de exercícios

Documentação: <https://gymapi.kadu.tec.br/docs/index.html#/> (OpenAPI 2.0 em `/docs/doc.json`).

Respostas vêm no envelope `{ status, data, metadata: { total_itens } }`:

| Endpoint | Conteúdo de `data` |
| --- | --- |
| `GET /exercises?Search=termo` | `ExerciseSimple[]` (`id`, `name`, `description`, `info_link`) |
| `GET /exercises/:id` | `Exercise` (`+ mappings: Amm[]`) |
| `GET /muscles/groups` | `MuscleGroup[]` (`id`, `name`, `portions[]`) |
| `GET /muscles` | mesmo conteúdo de `/muscles/groups` |
| `GET /muscles/portions` | `MusclePortion[]` (`id`, `muscle_group_id`, `name`) |
| `GET /muscles/movement-map` | `MuscleMovementInfo[]` (filtros `muscle_group`, `muscle_portion`, `joint`, `movement`) |
| `GET /joints` | `{ id, name }[]` |
| `GET /movements` | `{ id, name }[]` |

`Amm` = `{ muscle_portion, muscle_group, joint, movement, role }`.

Como a lista simples não traz `mappings`, `services/exerciseApi.js` hidrata os detalhes sob
demanda (com cache) para montar os chips de grupo muscular e o filtro. O cliente aceita tanto
o envelope `{ data }` quanto um payload cru, caso o contrato mude.

A referência muscular combina `/muscles/groups` com `/muscles/portions`: algumas respostas de
`/muscles/groups` não trazem (todas) as `portions`, então as porções da lista plana são
mescladas pelo `muscle_group_id`.

A API de produção exige autenticação (`401 Unauthorized` sem credenciais). Por isso ela
**não** é usada ainda: quando o acesso for liberado, basta apontar `EXERCISES_API_URL` para
`https://gymapi.kadu.tec.br/api/v1` e configurar `EXERCISES_API_AUTH_HEADER` /
`EXERCISES_API_AUTH_VALUE`.


## Estrutura

```
server.js                  Express, EJS, middlewares e bootstrap
config.js                  Config via variáveis de ambiente
routes/
  pages.js                 GET /, GET /day, GET /reference
  exercises.js             GET /exercises (busca/filtro), GET /exercises/:id (modal)
  workouts.js              POST/PATCH/DELETE /workouts/:date/entries[...]
services/
  db.js                    Pool MySQL (mysql2), transações e ping
  workoutStore.js          Persistência dos treinos no MySQL
  exerciseApi.js           Cliente da API (envelope, cache, hidratação, referência)
  dashboard.js             Monta as views (dia + catálogo + estatísticas)
lib/
  dates.js                 Datas ISO e formatação pt-BR
  reps.js                  Parse de "3x12"/"3x10-12" e volume
  labels.js                Rótulos de papel muscular (agonista etc.)
views/
  index.ejs                Layout, header com data, modais, toast
  partials/content.ejs     Painel do dia + catálogo
  partials/day-panel.ejs   Treino do dia (linhas, stats, vazio)
  partials/entry-row.ejs   Formulário HTMX de cada exercício do dia
  partials/catalog.ejs     Busca, filtro por grupo, lista
  partials/exercise-list.ejs / exercise-item.ejs
  partials/exercise-detail.ejs        Modal com mappings da API
  partials/reference.ejs              Modal de grupos/porções/articulações/movimentos
  partials/day-mutation.ejs           Painel + OOB do item do catálogo
  partials/entry-response.ejs         Linha + OOB das estatísticas
public/js/app.js           Datas, modais, toasts e feedback de erro
scripts/
  dev-all.js               Sobe mock + app juntos
  import-workouts.js       Importa o JSON legado para o MySQL
mock-api/                  Mock da API (porta 3005) + dados de exemplo
db/                        MySQL 8.4: Dockerfile, my.cnf e schema/seed
data/workouts.json         JSON legado (importável; o app não usa mais)
```

## Rotas do app

| Rota | Uso |
| --- | --- |
| `GET /` | Dashboard completo (data via `?date=AAAA-MM-DD`) |
| `GET /day` | HTML do painel + catálogo para troca de data (alvo `#content`) |
| `GET /exercises` | Lista filtrada (`search`, `group`, `date`) para `#exercise-list` |
| `GET /exercises/:id` | Detalhes do exercício para o modal |
| `GET /reference` | Grupos/porções/articulações/movimentos para o modal de referência |
| `POST /workouts/:date/entries` | Adiciona exercício (`exerciseId`) — atualiza painel + item do catálogo (OOB) |
| `PATCH /workouts/:date/entries/:exerciseId` | Salva `reps`, `weight` e `done` — atualiza linha + estatísticas (OOB) |
| `DELETE /workouts/:date/entries/:exerciseId` | Remove do dia — atualiza painel + item do catálogo (OOB) |
| `GET /health` | Status do app + conexão com o MySQL e URL da API em uso |

## Persistência

Os dados ficam no MySQL, normalizados para permitir múltiplos usuários no futuro:

- `users`: dono dos treinos. Sem login, o app usa `DEFAULT_USER_ID` (`default`, id `1`).
- `workouts`: um dia por usuário (`UNIQUE user_id + workout_date`).
- `workout_entries`: exercícios do dia (`UNIQUE workout_id + exercise_id`).

`services/workoutStore.js` mantém o mesmo contrato que as rotas/views já usavam
(`getDay`, `addEntry`, `updateEntry`, `removeEntry`), mas agora com SQL:

- `addEntry` cria o dia se necessário e faz upsert do exercício; se ele já existe, atualiza
  apenas o nome (quando informado) e o `updatedAt`.
- `updateEntry` altera `reps`, `weight_kg` e `done` em transação; registro ausente gera
  `ENTRY_NOT_FOUND` (HTTP `404` na rota).
- `removeEntry` apaga o exercício e, quando o dia fica vazio, remove também a linha em
  `workouts` (mesmo comportamento do JSON antigo). O `ON DELETE CASCADE` é uma segunda
  proteção.
- Timestamps são gravados em UTC (`DATETIME(3)`) e devolvidos como ISO 8601.
- `reps` aceita `3x12`, `3 x 10-12` ou `12`; o volume é `séries × reps × carga`.
- Carga aceita vírgula ou ponto (`42,5`).

O JSON antigo continua no repositório apenas como legado/backup. Para carregá-lo no banco,
use `npm run db:import` (veja acima).

## Comportamento e erros

- Toda busca/filtro/marcação é feita via HTMX, sem recarregar a página.
- Se a API estiver fora do ar, o painel do dia continua funcionando e o catálogo mostra o
  erro com botão "Tentar novamente".
- Erros HTTP em mutações e falhas de conexão aparecem como toast no canto da tela.
- Datas inválidas em mutações retornam `400`; registros inexistentes retornam `404`.

## Identidade visual e temas

A interface tem **cinco temas** selecionáveis no header (canto superior direito). A escolha
fica salva em `localStorage` (`treino-theme`) e é aplicada antes do primeiro paint, sem flash
de tema errado.

| Tema | Perfil |
| --- | --- |
| `terroso` (padrão) | creme + verde-oliva + dourado |
| `meia-noite` | escuro quente, texto claro e verde profundo |
| `oceano` | claro com primário verde-água e acento âmbar |
| `ameixa` | claro com primário vinho e acento cobre |
| `carmim` | escuro avermelhado, primário bordô e acento vermelho vivo |

Todas as partials usam **tokens semânticos** (`bg-surface`, `text-ink`, `border-sand`,
`bg-moss`, `text-on-primary`...), então a troca de tema vale também para o conteúdo trocado
via HTMX. Cada token é um trio RGB em variável CSS definido em `views/index.ejs`; o
`tailwind.config` inline consome esses canais via `rgb(var(--c-*) / <alpha-value>)`, o que
preserva opacidades como `bg-moss/90`, `border-sand/80` e `ring-gold/30`. As sombras
`shadow-card`/`shadow-soft` também vêm de variáveis (`--shadow-card`, `--shadow-soft`).

| Token | Papel |
| --- | --- |
| `cream` | fundo da página |
| `surface` | fundo de cards, campos e modais |
| `ink` | texto principal |
| `bark` | textos de apoio e links |
| `olive` | textos secundários e rótulos |
| `moss` | ação primária (botões, tile de volume, logo) |
| `on-primary` | texto sobre `moss` |
| `primary-hover` | hover da ação primária |
| `inverted` / `on-inverted` | toast e botões escuros (invertem no tema escuro) |
| `sand` | bordas e divisores |
| `sage` | acentos neutros e estado "no treino" |
| `gold` | acento/destaque |

Para criar um tema novo: copie um bloco `[data-theme='...']` em `views/index.ejs`, ajuste os
trios RGB e registre o nome em `THEMES` (`views/index.ejs` e `public/js/app.js`) e no
`<select id="theme-select">`. Garanta contraste de `on-primary` sobre `moss` e de
`on-inverted` sobre `inverted`.

Tipografia: **Fraunces** (títulos, via `font-display`) e **Inter** (corpo, `font-sans`),
carregadas do Google Fonts com fallback para fontes do sistema.

## Próximos passos

1. Autenticação: usar a tabela `users` e substituir o `DEFAULT_USER_ID` pela sessão.
2. Liberar/autenticar a API de produção e trocar `EXERCISES_API_URL` (+ auth).
3. Confirmar o parâmetro de busca usado em produção (`Search` por padrão).
4. Opcional: histórico/relatórios por período e exportação dos treinos.
