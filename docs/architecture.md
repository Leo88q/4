# Архитектура «Палимпсеста»

Компаньон к [CONCEPT.md](../CONCEPT.md) §8–9. Здесь — как это устроено в коде.

## Карта репозитория

```
packages/common/     детерминированные примитивы: sha256 (портативный), sfc32 RNG, Merkle
packages/sim/        Restory.Sim v1 — генерация пазла, необратимые действия, скоринг
packages/server/     HTTP API, сессии, античит, Книга Слоёв (mock), веб-демо
chain/               Anchor-программа palimpsest_book + JS SDK для commitments
client/unity/        C#-порт симуляции + PalimpsestBridge + инструкция интеграции
scripts/             fetch-upstream.sh (форк google/restory), gen-vectors.js
third_party/restory/ [не в git] форк upstream на пине (создаётся скриптом)
docs/                lore, архитектура, API
```

## Главная идея: одна симуляция — три среды

Спор о том, «считает клиент или сервер», снимается просто: правила реставрации живут в **одном модуле**, который исполняется в трёх местах:

| Где | Зачем | Реализация |
|---|---|---|
| Сервер | Источник истины: принимает/отвергает реставрацию | `packages/sim` (JS) |
| Браузер (демо) | UX без задержек: тот же пазл из сида | те же файлы через import map |
| Unity | Мобильный клиент | `client/unity/PalimpsestSim` (C#-порт, паритет-векторы) |

Клиент шлёт **ленту операций** (с таймингами), а не «результат». Сервер переигрывает ленту из сида и сравнивает `stateHash`. Расхождение = баг или чит; результат всё равно серверный.

### Как достигается бит-детерминизм JS ↔ C#

* RNG — sfc32 только на uint32-операциях (`Rng.cs` ↔ `seed.js`).
* Все дробные вычисления — IEEE-754 `double` в одинаковом порядке операций; вместо `Math.hypot` — явный `sqrt(dx²+dy²)`.
* Округление: JS `Math.round` ↔ C# `Math.Round(..., MidpointRounding.AwayFromZero)` (совпадают на неотрицательных значениях).
* Хэширование состояния — sha256 по квантованным слоям (`stateBytes`), в C# — `System.Security.Cryptography`.
* Паритет закреплён векторами: `scripts/gen-vectors.js` → `client/unity/test-vectors.json` + `TestVectors.g.cs`; тесты с обеих сторон.

## Поток данных

```
1. GET /api/daily -> сид (детерминированный + цепная случайность при включённом коммите)
2. Клиент: generate(сид) -> пазл (слои: paint/varnish/loss/tear)
3. Игрок: действия (solvent/wipe/patch/brush/varnish/diagnose/finish)
4. POST /api/session/:id/actions -> validateActionLog (структура, тайминги, лимиты)
5. POST /api/session/:id/finish  -> simulate(сид, лента) — серверная переигровка
6. Скоринг -> Индекс Палимпсеста; Merkle от хэшей действий -> actionsMerkle
7. Книга Слоёв: append запись «act» (mock-цепочка или commit_act on-chain)
8. Ответ: артефакт (score, merkle, stateHash) -> лидерборд, аттестат
```

## Книга Слоёв: две реализации, одна схема

* **Mock** (`CHAIN_MODE=mock`, по умолчанию): append-only хеш-цепочка в `data/db.json`. Каждая запись хэширует предыдущую; `GET /api/book` верифицирует цепочку; порча записи видна (`brokenAt`). Тест `api.test.js` это доказывает.
* **Solana** (`chain/programs/palimpsest_book`): те же записи как `commit_act` / `append_note` с `state_hash`, `actions_merkle`, `uri` (паспорт в Arweave/IPFS). Полные логи в цепь не ложатся — только корни.

В обоих режимах действует правило лора: **«Книгу нельзя переписать — только дописать»**.

## Античит (распределение ответственности)

| Проверка | Где | Код |
|---|---|---|
| Схема действий, лимиты, time-travel | общий модуль | `sim/actions.js` `validateActionLog` |
| Минимальный интервал 60 мс | общий модуль | там же |
| Rate limit на IP | сервер | `server/anticheat.js` |
| Метроном-паттерны, «слишком быстро» | сервер | `analyzePace` |
| Полная переигровка результата | сервер | `simulate()` |
| Сверка stateHash клиента | сервер | флаг `client_mismatch` в артефакте |
| Экономические капы | сервер/экономика | дневные лимиты наград (roadmap Beta) |

## Хранение и масштабирование

Сейчас — in-memory + JSON-снапшот (`Store`). Интерфейс намеренно маленький: игроки/сессии/артефакты/книга. Продакшен-замена:

* PostgreSQL — сущности + ленты действий (append-only таблицы);
* Redis — сессии, лимиты, лидерборды;
* Arweave/IPFS — паспорта провенанса;
* Anchor-программа — commitments; cNFT (Bubblegum) — минт артефактов.

## Модель безопасности

* Сервер не доверяет ни одному числу из клиента, кроме самой ленты операций — и её он переигрывает.
* Ground truth диагноза (`findings`) **не отдаётся** клиенту (`publicSpec` её вырезает).
* `data/` и `third_party/` — в `.gitignore`; секретов в репо нет.
* Rate limit + ограничение тела запроса (2 МБ).
* Репутация и Книга — публично проверяемые: пересчёт Merkle и `simulate()` третьей стороной (см. `chain/README.md`).

## Про upstream google/restory

Unity-проект (механики реставрации, шейдеры, диалоги, WebGL-сборка) — база клиента. Он фетчится на пин `67b94f1` скриптом `scripts/fetch-upstream.sh` и модифицируется drop-in модулями `client/unity/` (см. `client/unity/INTEGRATION.md`). Атрибуция и лицензионные обязательства — в корневых `LICENSE`, `NOTICE`.
