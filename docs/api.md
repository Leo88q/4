# API «Палимпсеста»

Base URL: `http://<host>:<port>` (по умолчанию `:8787`). Все ответы — JSON. POST-эндпоинты принимают `content-type: application/json`.

## Системные

### `GET /api/health`
```json
{ "ok": true, "simVersion": 1, "chainMode": "mock", "storage": "json", "bookHead": "…", "bookVerified": true }
```

### `GET /api/daily`
Заказ дня: сид и публичная спецификация пазла. **Ground truth диагноза не отдаётся.** Коммит-раскрытие цепной случайности (CONCEPT.md §7.4): `entropyCommit` публикуется заранее, `entropyRevealed` становится `true` после раскрытия (`CHAIN_ENTROPY_COMMIT` / `CHAIN_ENTROPY`).
```json
{
  "ok": true,
  "date": "2026-10-11",
  "seed": "palimpsest-daily-v1:2026-10-11",
  "spec": { "version": 1, "seed": "…", "epoch": "Модерн", "title": "Святой с книгой", "year": 1809, "N": 32, "par": 52 },
  "chainEntropyBound": false,
  "entropyCommit": null,
  "entropyRevealed": false
}
```

## Игрок и сессии

### `POST /api/player` — `{ "name": "Мара" }`
→ `{ "ok": true, "player": { "id": "plr_…", "name": "Мара", "address": "…" } }`

### `POST /api/session` — `{ "playerId": "plr_…", "kind": "daily" | "private" }`
→ `{ "ok": true, "sessionId": "ses_…", "seed": "…", "spec": {…}, "startedAt": 0 }`

Сессия живёт 30 минут (`SESSION_TTL_MS`). Пазл клиент генерирует локально из `seed` модулем `@palimpsest/sim`.

### `POST /api/session/:id/actions` — `{ "actions": [Action, …] }`
Потоковая отправка ленты. Каждый `Action`:

```json
{ "type": "solvent", "t": 1800000000000, "x": 0.5, "y": 0.5, "r": 0.09, "strength": 0.55 }
```

| type | поля |
|---|---|
| `diagnose` | `findings: string[]` (до 8) |
| `solvent` | `x, y, r, strength` |
| `wipe` | `x, y, r` |
| `patch` | `x, y, w, h, material` (0 бумага / 1 лён / 2 шёлк) |
| `brush` | `x, y, r, color: [r,g,b]` |
| `varnish` | `kind` (0 мастикс / 1 шеллак / 2 синтетика), `thickness` |
| `finish` | — |

Координаты — нормализованные `[0,1]`. Между действиями ≥ 60 мс, всего ≤ 800. Ответ: `{ ok, accepted, total }`; ошибки: `too_fast:*`, `time_travel`, `bad_color`, `unknown_type:*` и др.

### `POST /api/session/:id/finish` — `{ "actions": [ …, { "type": "finish", "t": … } ], "clientStateHash": "…" }`
Сервер переигрывает **всю** ленту из сида и принимает решение. Ответ:

```json
{
  "ok": true,
  "artifact": {
    "id": "art_…", "score": { "total": 87, "components": { "accuracy": 91, "integrity": 80, "rationality": 88, "discoveries": 75 } },
    "stateHash": "…", "stateHashMatch": true, "actionsMerkle": "…",
    "bookSeq": 3, "flags": [], "provenanceCid": "ar://…"
  },
  "chainCommit": { "mode": "mock", "localSeq": 3 },
  "bookHead": "…",
  "leaderboard": [ … ]
}
```

`chainCommit.mode`: `mock` (локальная Книга) | `solana` (есть `signature`) | `solana-prepared` (payload закодирован, отправка при настройке RPC) | `solana-unconfigured`. Флаги античита: `haste`, `thin_log`, `metronome`, `client_mismatch`.

## Провенанс и репутация

| Метод | Путь | Что даёт |
|---|---|---|
| GET | `/api/artifact/:id` | артефакт + merkle-корень + записи Книги + **`aging`** («Дыхание времени»: проекция старения на 10/25/50 лет по типу лака) |
| GET | `/api/artifact/:id/metadata` | метаданные cNFT (формат Приложения C CONCEPT.md) |
| GET | `/api/leaderboard?date=YYYY-MM-DD` | топ-20 дня |
| GET | `/api/attestation/:playerId` | Аттестат: работы, средний Индекс, ранг, кошелёк |
| GET | `/api/book` | Книга Слоёв: верификация цепочки + последние записи |

Поле `artifact.conservation` — зафиксированное решение о консервации
(тип лака, толщина); оно же управляет проекцией старения: мастикс желтеет
медленнее шеллака, толстый слой — быстрее тонкого, без консервации быстрее
всего (см. `packages/sim/src/aging.js`).

## Социальный слой (CONCEPT.md §5)

### Мастерские
| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/guild` | основать: `{name, motto, playerId}` (до 50 участников, одна гильдия на игрока) |
| GET | `/api/guild/:id` | состав + статистика (престиж, статус «Мастерская»/«Музей») |
| GET | `/api/guilds` | рейтинг по престижу |
| POST | `/api/guild/:id/join` / `/leave` | `{playerId}` |

### Вернисаж
| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/vernissage` | экспонаты, голоса, итоги сезона |
| POST | `/api/vernissage/submit` | `{playerId, artifactId}` — один экспонат от гильдии |
| POST | `/api/vernissage/vote` | `{playerId, artifactId}` — один голос |
| POST | `/api/vernissage/close` | закрыть сезон: призы 300/150/50 пигментов, престиж гильдиям |

### Тихий торг (запечатанные ставки)
| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/auction` | `{artifactId, sellerId, minBid, durationMin}` |
| GET | `/api/auction/:id` | вид снаружи: количество ставок, без сумм |
| POST | `/api/auction/:id/bid` | `{playerId, amount}` — скрыта до завершения |
| POST | `/api/auction/:id/settle` | после `endsAt`: победитель, перевод Пигментов, комиссия 5%, смена владельца |

### Пентименто
| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/cases` | открытые дела + улики (флаги, ошибки диагноза, stateHash) |
| POST | `/api/case/:artifactId/investigate` | `{playerId, verdict: 'fake'\|'authentic'}` — награда/штраф, запись в Книгу |

Владелец не может расследовать своё дело. Правда спрятана на сервере
(`evidence().suspicious`); вердикт сверяется с ней.

### cNFT (Metaplex Bubblegum)
| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/artifact/:id/mint` | минт cNFT-артефакта: план (дерево, leaf index, assetId), метаданные с provenance-корнем и консервацией, запись `mint` в Книгу. Повторный минт — `409 already_minted` |
| GET | `/api/artifact/:id/metadata` | DAS-метаданные cNFT (buildMetadata из chain-sdk) |

`mint.assetId` в mock-режиме — детерминированная заглушка (`asset_…`); реальный
id выводится on-chain/DAS после минта через Bubblegum (см. `chain/README.md`).

### Сезон и Манифест (§4.6)
| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/season?playerId=` | сезон (`palimpsest-season-v1:YYYY-QN`), Манифест (уровень/опыт), слой Аттестата, сезонная статистика |
| POST | `/api/season/manifest/unlock` | `{playerId}` — платная глава Манифеста, 100 Киновари. **Только косметика** (темы, инструменты, залы) — не влияет на оценку |
| POST | `/api/season/manifest/claim` | `{playerId, level}` — выдача наград уровня (без дублей) |

Опыт: реставрация +20, турнирная партия +30, показ на Вернисаже +15.
Слой Аттестата: Бронза → Серебро → Золото → Лазурит (лучший за сезон:
титул + вклад). Киноварь — только за эталонные реставрации (Index ≥ 90) и победы.

### Турниры (§4.7)
| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/tournaments` | список турниров сезона |
| POST | `/api/tournament` | `{name, kind: 'duel'\|'triptych', sponsor}` — Дуэль (3 партии) / Триптих (5) |
| GET | `/api/tournament/:id` | турнир + таблица (медиана Index-а) |
| POST | `/api/tournament/:id/enter` | `{playerId}` — вход свободный |
| POST | `/api/tournament/:id/start` | старт: фонд = спонсор + комиссии Тихого торга |
| POST | `/api/tournament/:id/finish` | призы 50/30/20, доля гильдии победителю, +10 Киновари чемпиону |

Партии играются обычными сессиями: `POST /api/session {kind:'tournament', tournamentId}` —
сид раунда одинаков у всех (равный старт), счёт начисляется сервером
(пересимуляция из сида). Взносов участников нет: фонд — спонсор + 50% комиссии
Тихого торга (§4.2).

## Проверка третьей стороной

1. `actionsMerkle` == `buildMerkle(actionHashes).root` (`@palimpsest/common`).
2. `simulate(seed, actions).stateHash` == `artifact.stateHash` (`@palimpsest/sim`).
3. Запись `bookSeq` целостна в `/api/book` (или в `commit_act` on-chain).

Пример живого вызова — `packages/server/public/app.js` (демо делает ровно это).
