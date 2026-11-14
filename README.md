# Treino do Dia

Workout tracker minimalista para uso pessoal: selecione um dia, busque exercícios na API,
registre séries/repetições/carga e marque o que foi feito. Tudo persistido localmente em
`data/workouts.json`.

- **Backend:** Node.js (ES Modules) + Express + EJS
- **Frontend:** Tailwind CSS (CDN) + HTMX 2 (CDN), sem build step
- **Dados de treino:** JSON local
- **Exercícios:** API externa (mock local durante o desenvolvimento)

## Como rodar (com o mock da API)

```bash
npm install

# opção 1: mock + app no mesmo terminal
npm run dev:all

# opção 2: dois terminais
npm run dev:mock          # mock em http://localhost:3005/api/v1
npm run dev               # app em http://localhost:3000
```

Abra <http://localhost:3000>.

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
porta `3000` e tem `HEALTHCHECK` batendo em `/health`. Os treinos ficam no volume
`/app/data` — o `data/workouts.json` local **não** entra na imagem (ver `.dockerignore`).

### Só o app

```bash
docker build -t treino-do-dia .
docker run --rm -p 3000:3000 \
  -e EXERCISES_API_URL=https://gymapi.kadu.tec.br/api/v1 \
  -v treino-data:/app/data \
  treino-do-dia
```

> Sem `EXERCISES_API_URL` o padrão é `http://localhost:3055/api/v1`, que dentro do
> container não existe: o catálogo mostraria o erro da API (o painel do dia continua
> funcionando). Use o compose abaixo para subir junto com o mock.

### App + mock da API (compose)

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
- Treinos persistem no volume nomeado `workouts-data`:

```bash
docker compose exec app cat /app/data/workouts.json
```

- Bind mount alternativo (`-v "$PWD/data:/app/data"`) exige que o diretório pertença ao
  uid `1000`, pois o processo roda como `node`.

## Variáveis de ambiente

Copie `.env.example` para referência. O app lê as variáveis do processo (use `export`,
`env` ou o gerenciador de processos que preferir).

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
  workoutStore.js          Persistência em data/workouts.json (fila + escrita atômica)
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
mock-api/                  Mock da API (porta 3005) + dados de exemplo
data/workouts.json         Registros dos treinos (criado/atualizado pelo app)
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
| `GET /health` | Status do app e URL da API em uso |

## Persistência

`data/workouts.json` é um objeto por data:

```json
{
  "2026-11-13": {
    "date": "2026-11-13",
    "entries": [
      { "exerciseId": 88, "exerciseName": "Supino Reto", "reps": "4x10", "weight": 42.5, "done": true }
    ]
  }
}
```

- Escritas usam fila interna + arquivo temporário + `rename` (sem corromper o JSON).
- O dia é removido do arquivo quando fica sem exercícios.
- `reps` aceita `3x12`, `3 x 10-12` ou `12`; o volume é `séries × reps × carga`.
- Carga aceita vírgula ou ponto (`42,5`).

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

1. Liberar/autenticar a API de produção e trocar `EXERCISES_API_URL` (+ auth).
2. Confirmar o parâmetro de busca usado em produção (`Search` por padrão).
3. Opcional: histórico/relatórios por período e exportação dos treinos.
