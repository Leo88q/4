# Solana-слой «Палимпсеста»

Всё, что живёт в цепи, — **только обязательства (commitments)**: корни Меркле от лент действий, хэши состояний, счётчики репутации. Полные логи — в Arweave/IPFS (`uri`), и любой может сверить одно с другим. «Книгу нельзя переписать — только дописать» (CONCEPT.md §7.2).

## Состав

| Путь | Что это |
|---|---|
| `programs/palimpsest_book/` | Anchor-программа: `initialize_book`, `commit_act`, `append_note`, `init_attestation`, `record_work`, `record_fake_exposed` |
| `sdk/index.js` | Построение payload для инструкций + mock-адаптер (используется сервером в режиме `CHAIN_MODE=mock`) |

## Режимы работы сервера

* `CHAIN_MODE=mock` (по умолчанию) — локальная хеш-цепочка в `data/db.json`: те же схемы записей, верифицируемая целостность (`GET /api/book`), нулевая стоимость. **Для разработки и демо.**
* `CHAIN_MODE=solana` — сервер подписывает `commit_act` кошельком платформы (authority) после каждого Акта реставрации; `record_work` — для публичных кошельков игроков (Mobile Wallet Adapter). См. `sdk/index.js`: payload-билдеры уже соответствуют программе.

## Записи и их смысл

| Инструкция | Что фиксирует | В интерфейсе продукта |
|---|---|---|
| `commit_act` | state_hash, actions_merkle, Индекс, uri паспорта | «Акт реставрации», минт cNFT (Bubblegum, отдельный поток) |
| `append_note` | поздние находки: вердикт Пентименто, восстановленный провенанс | «Дописать в Книгу» |
| `init_attestation` / `record_work` | счётчики репутации мастера | «Аттестат» |
| `record_fake_exposed` | доказанные подделки | титулы Смотрителей |

## Сборка и деплой

```bash
# требуются Rust + Solana CLI + Anchor 0.30.x (в CI-контейнере)
anchor build
anchor deploy --provider.cluster devnet
# program id записывается в declare_id! и в .env сервера
```

В этом репозитории Rust-тулчейна нет — программа поставляется исходником с инвариантами, которые уже проверены тестами JS-симуляции и mock-книги (`npm test`). Перед mainnet — аудит.

## Проверка без цепи

Любой может пересчитать историю артефакта:

1. `GET /api/artifact/:id` → `actionsMerkle`, `actionHashes`, `bookSeq`.
2. Пересчитать `buildMerkle(actionHashes).root` — должен совпасть.
3. Прогнать `simulate(seed, actions)` из `@palimpsest/sim` — `stateHash` должен совпасть.
4. Сверить запись `#bookSeq` в `/api/book` (или в `commit_act` on-chain).

Именно это и означает «Solana здесь про владение, провенанс и проверяемость» (CONCEPT.md §7.7).
