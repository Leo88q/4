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

## Проекция телеметрии (Mechanic_* -> лента действий)

Реальные механики форка проецируются на **канонический словарь действий** симуляции
(`solvent/wipe/patch/brush/varnish/diagnose/finish`). Патчи (все с пометкой
«Modified by The Palimpsest Authors», собираются `scripts/integrate-upstream.sh`):

| Механика upstream | Событие | Действие |
|---|---|---|
| `Mechanic_VarnishRemoval/Brush` | мазок растворителем | `solvent` (троттлинг 60 мс) |
| `Mechanic_VarnishRemoval/Brush` | нанесение лака | `varnish` |
| `Mechanic_Color/PaintDamage.IsFixed` | утрата закрашена | `brush` (цвет из `PalimpsestTelemetry.CurrentColor`) |
| `Mechanic_Patching/PlacePatch` | заплатка поставлена | `patch` (материал «лён») |
| `Mechanic_Locking/CreateStitch` | шов наложен | `patch` (материал «шёлк») |
| `Mechanic_DeclareFinish/declareFinish` | Акт реставрации | `NotifyFinish()` -> `finish` |

Координаты нормализуются через `Camera.main.WorldToViewportPoint` -> [0,1].
`PalimpsestTelemetry` сам держит минимальный интервал 60 мс (то же правило,
что проверяет сервер).

**Честность проекции.** Пока Unity-уровни рисуют собственные картины, а сервер
переигрывает канонический пазл из сида сессии — телеметрия описывает *операции
мастера*, а не попиксельный результат. Это интеграционный срез: словарь, конвейер
и точки врезки настоящие; следующий шаг (roadmap «Прототип») — рендерить в Unity
именно пазл из сида (`PalimpsestSim.Generate`), чтобы проекция стала точной.
Локальный `ScoringManager` продолжает работать как и раньше; серверный Индекс —
источник истины для наград.

## Поток данных (напоминание из CONCEPT.md §9.3)

```
сид -> клиент генерирует пазл (PalimpsestSim) -> игрок реставрирует
-> лента операций на сервер -> сервер переигрывает -> Индекс + Книга Слоёв
-> ответ клиенту (score, merkle, artifact) -> локальный сертификат
```

Расхождение `clientStateHash` не блокирует игрока, но пишет флаг `client_mismatch` в артефакт — это вход для античит-аналитики.
