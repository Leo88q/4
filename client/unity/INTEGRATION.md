# Интеграция Unity-клиента (форк google/restory)

Клиент — форк открытого проекта Restory. Мы **не вендорим** его исходники в этот репозиторий (46 МБ ассетов, см. `scripts/fetch-upstream.sh`); вместо этого — пин на коммит + drop-in модули ниже. Лицензия Apache 2.0 соблюдается так:

1. `scripts/fetch-upstream.sh` клонирует upstream на закреплённый коммит в `third_party/restory/` вместе с его `LICENSE.txt`.
2. Копия Apache 2.0 и `NOTICE` лежат в корне этого репозитория и поставляются с любой сборкой.
3. Атрибуция (© Google LLC, авторы Restory) — в README, в экране «О проекте» игры и на страницах сторов.
4. В изменённых файлах форка — пометка «Modified by The Palimpsest Authors» (требование Apache 2.0 §4(b)).
5. Название «Google» не используется в маркетинге продукта.

## Шаги

```bash
# 1. Получить upstream
bash scripts/fetch-upstream.sh

# 2. Скопировать модули Palimpsest в проект Unity
cp -r client/unity/PalimpsestSim   third_party/restory/Assets/Scripts/PalimpsestSim
cp    client/unity/PalimpsestBridge.cs third_party/restory/Assets/Scripts/
```

В Unity (2021.3+):

1. Открыть `third_party/restory` как проект; убедиться, что сборка собирается.
2. Создать GameObject `Palimpsest`, повесить `PalimpsestBridge`, указать `apiBase` (для локального запуска — `http://localhost:8787`, для превью — URL сервера).
3. В `Assets/Scripts` найти модули механик (Mechanic_VarnishRemoval и др.) и в момент `Mechanic_DeclareFinish` вызывать:

```csharp
// Собираем ленту действий по ходу реставрации:
//   new RestorationAction("solvent", nowMs) { X=.., Y=.., R=.., Strength=.. } и т.д.
bridge.Push(action);              // на каждое действие
StartCoroutine(bridge.FlushPending());   // раз в 2–5 секунд
StartCoroutine(bridge.Finish(result => {
    // result.artifact.score.total — Индекс Палимпсеста (серверный!)
    // result.artifact.actionsMerkle — корень Книги Слоёв
    ShowAct(result);              // экран «Акт реставрации» (Certificate/FinishStampDate)
}));
```

4. Локальный прогресс (`SaveData`) хранить как раньше, но **источник истины для наград — ответ сервера**.
5. Экран «О проекте» (Settings) добавить блок атрибуции из корневого `NOTICE`.

## Паритет симуляции

`PalimpsestSim/` — бит-в-бит порт `packages/sim` (JS). Паритет закреплён векторами:

* `test-vectors.json` — для CI и сверки вручную;
* `PalimpsestSim/TestVectors.g.cs` — те же числа как C#-константы;
* `PalimpsestSim/ParityTests.cs` — NUnit-тесты (Unity Test Framework).

Пересобрать векторы после любого изменения симуляции:

```bash
node scripts/gen-vectors.js   # из корня репозитория
```

Если векторы изменились — обновить и JS, и C#, и поднять `SIM_VERSION` в `packages/sim/src/const.js`.

## Поток данных (напоминание из CONCEPT.md §9.3)

```
сид -> клиент генерирует пазл (PalimpsestSim) -> игрок реставрирует
-> лента операций на сервер -> сервер переигрывает -> Индекс + Книга Слоёв
-> ответ клиенту (score, merkle, artifact) -> локальный сертификат
```

Расхождение `clientStateHash` не блокирует игрока, но пишет флаг `client_mismatch` в артефакт — это вход для античит-аналитики.
