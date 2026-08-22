# Карта переноса Platform Interface

Документ к TASK-REPO-MERGE-001 (см. `merge-plan.txt`).
Ветка интеграции: `integration/platform-interface` (от `main` = `53ac169`).
Источник: remote `ivan` → `spitegod/taksi-platform-interface`, `ivan/main` = `62cea1a`.

Составлен по фактическому сравнению деревьев, не по тексту ТЗ.

---

## 0. Резюме

Перенос **существенно проще, чем предполагает ТЗ**. Три причины:

1. Иван вёл работу поверх снапшота Taxi одним коммитом `03c7af2`, а вся PI-разработка лежит в
   6 последующих коммитах. Значит архитектурная дельта вычисляется точно: `git diff 03c7af2 ivan/main`
   — **134 файла, +12 061 / −791**.
2. Из 103 новых файлов **ни один не конфликтует** с актуальным Taxi — `src/platform/**` и `docs/**`
   в основном репозитории отсутствуют полностью.
3. Иван **не менял** `package.json`, `package-lock.json`, `tsconfig.json`, `.eslintrc.json`,
   `config/`, `scripts/`. Новых зависимостей нет, сборочная конфигурация не затронута.

Реальный объём ручной работы — **19 файлов**, из них по-настоящему тяжёлый **один**:
`src/pages/Driver/Map.tsx`.

### Расхождения ТЗ с фактическим состоянием

| Пункт ТЗ | Что в ТЗ | Что на самом деле |
|---|---|---|
| п.3, п.5 | база — актуальный `main` | на момент старта `main` отставал на 9 коммитов; работа была влита через PR #8, `main` = `53ac169` актуален |
| п.14 | «нельзя просто заменить текущий `DriverMapGateway` версией Ивана» | файла в основном репозитории **нет**, заменять нечего. Он переносится как новый; ручное объединение нужно его *потребителю* — `src/pages/Driver/Map.tsx` |
| п.15 | `src/index.tsx` объединяется вручную | Иван **не трогал** `src/index.tsx`. Фактическая точка — `src/pages/Driver/Map.tsx` |
| п.18 | `docs/ARCHITECTURE.md` не заменять целиком, объединить вручную | каталога `docs/` в основном репозитории **нет**. Все 18 документов переносятся как новые, объединять нечего |
| п.23 | по возможности сохранить авторство через cherry-pick | у репозиториев нет общей истории (`unrelated histories`) и разная структура каталогов (`src/…` vs `taxi/src/…`). Cherry-pick неприменим; авторство — через `Co-Authored-By` + ссылки на SHA |

---

## 1. Структура и правило ремапа путей

Корень репозитория Ивана поэлементно совпадает с содержимым каталога `taxi/` основного репозитория.

```
ivan/main:src/…            →  taxi/src/…
ivan/main:docs/…           →  taxi/docs/…
```

Правило переноса без потери авторства:

```
git show ivan/<sha> -- <path> | git apply --directory=taxi --3way
```

## 2. Коммиты Ивана как единицы переноса

| SHA | Сообщение | Файлов | Роль |
|---|---|---|---|
| `03c7af2` | first comm | 1015 | импорт старой копии Taxi — **не переносится** |
| `91a8426` | commit changes | 20 | Map Channel, первые доки |
| `c0c8810` | changes new | 17 | развитие Map Channel |
| `6671f69` | Integrate Platform Interface with taxi backend | 106 | основной массив PI |
| `c81f5a2` | Finalize asynchronous command integration | 12 | Command API, FSM-транспорты |
| `1276759` | Document command completion contract | 3 | документация completion |
| `62cea1a` | Extract command completion waiter | 7 | `DriverCommandCompletionWaiter` |

Переносится дельта `03c7af2..62cea1a`.

## 3. Категория A — переносится как есть (103 файла, конфликтов нет)

Проверено: ни одного из этих путей нет в `main:taxi/`.

### 3.1. `src/platform/**` → `taxi/src/platform/**` (85 файлов)

| Подсистема | Файлов | Содержимое |
|---|---|---|
| `platform-interface/` | 44 | `PlatformInterfaceRuntime`, `Surface`, `SurfaceRegistry`, `SnapshotProvider`, `ReconnectingSnapshotTransport`, `snapshot.ts`, `compositionRoot`, `validateComposition`, `realtime/ReconnectingWebSocketClient`, `navigation/*`, `surfaces/{driver,passenger,map}/*`, 12 тестов |
| `adapters/` | 23 | `DriverMapGateway`, `DriverCommandCompletionWaiter`, `FsmTaxiCommandTransport`, `FsmDriverSnapshotTransport`, `FsmOrderSnapshotTransport`, `LegacyBackendGateway`, `LegacyChatGateway`, `LegacyPassengerGateway`, `LegacyReduxSnapshotProvider`, `LegacyRouteProvider`, `LegacyPassengerChannelStoreAdapter`, `backendError`, 10 тестов |
| `map-channel/` | 11 | `MapChannel`, `MapMapper`, `MapApplicationHandler`, `AppInteractionContract`, `map-channel-protocol`, `useMapChannel`, 3 теста |
| `interaction-contract/` | 7 | `action`, `api`, `error`, `event`, `model`, `version` |

**`LegacyBackendGateway` переносится без правок**: все 34 функции `API.*`, которые он оборачивает,
присутствуют в актуальном `taxi/src/API/` — проверено поимённо.

### 3.2. `docs/**` → `taxi/docs/**` (18 файлов)

`ARCHITECTURE.md`, `MAP_CHANNEL.md`, `MOCK_MODE.md`, `PASSENGER_CHANNEL_MIGRATION.md`,
`PLATFORM_INTERFACE_{REVIEW,RUNTIME,STAGE1_REPORT,STAGE3_6_REPORT}.md`, `REPOSITORY_MAP.md`,
`ROADMAP_PLATFORM_CORE.md`, `STAGE1_REPORT.md`, `STATE_AND_API.md`, `SURFACE_MODEL.md`,
`TASK_CORE_001_COMMAND_COMPLETION.md`, `TASK_FE_002_COMMAND_COMPLETION_WAITER.md`,
`TASK_PI_001_QUERY_REALTIME.md`, `migration/AQ_PLATFORM_{001,002}.md`.

## 4. Категория B — патч Ивана ложится чисто (12 файлов)

Файл не изменялся Гусейном относительно базы `03c7af2` — блоб побайтово совпадает.
Применяется `git apply --directory=taxi --3way` без разбора.

```
src/App.tsx                                  src/components/modals/LoginModal/Login.tsx
src/Routes.tsx                               src/components/modals/LoginModal/RefCodeModal.tsx
src/components/Chat/index.tsx                src/components/modals/TakePassengerModal.tsx
src/components/LocationInput/index.tsx       src/pages/Passenger/VotingForm.tsx
src/components/Map/index.tsx                 src/pages/Passenger/uiFsm.ts
src/components/PassengerLiveOrder/index.tsx  src/types/passengerUi.ts
```

`src/pages/Passenger/uiFsm.ts` превращается в re-export из
`platform/platform-interface/surfaces/passenger`. Существующий тест
[taxi/src/pages/Passenger/__tests__/uiFsm.test.js](taxi/src/pages/Passenger/__tests__/uiFsm.test.js)
идентичен базе Ивана и продолжит работать через re-export — но это точка обязательной проверки.

## 5. Категория C — ручное объединение (19 файлов)

Оба разработчика меняли файл относительно базы `03c7af2`. Приоритет №1 ТЗ: основой берётся
**актуальная версия Гусейна**, поверх накладывается PI-часть Ивана.

| Файл | Правки Ивана | Правки Гусейна | Сложность |
|---|---|---|---|
| `src/pages/Driver/Map.tsx` | +102/−144 | **+1874/−1509** | **высокая** |
| `src/pages/Order/index.tsx` | +47/−60 | +252/−86 | средняя |
| `src/components/modals/CardModal.tsx` | +31/−47 | +171/−68 | средняя |
| `src/pages/Driver/Orders.tsx` | +34/−10 | +113/−29 | средняя |
| `src/pages/Passenger/index.tsx` | +12/−51 | +5/−1 | средняя |
| `src/pages/Driver/index.tsx` | +11/−8 | +219/−40 | низкая |
| `src/components/modals/ProfileModal.tsx` | +10/−11 | +1/−0 | низкая |
| `src/components/Header/index.tsx` | +7/−6 | +79/−11 | низкая |
| `src/components/modals/CandidatesModal.tsx` | +7/−7 | +2/−1 | низкая |
| `src/components/modals/VoteModal.tsx` | +5/−5 | +4/−1 | низкая |
| `src/components/modals/DriverCancelModal.tsx` | +5/−5 | +12/−1 | низкая |
| `src/components/MiniOrders/index.tsx` | +4/−3 | +2/−1 | низкая |
| `src/components/MiniOrder/index.tsx` | +3/−3 | +11/−11 | низкая |
| `src/components/modals/DriverModal.tsx` | +3/−3 | +2/−1 | низкая |
| `src/components/modals/OnTheWayModal.tsx` | +2/−2 | +2/−1 | низкая |
| `src/components/modals/RatingModal.tsx` | +2/−2 | +6/−0 | низкая |
| `src/components/DriverEmulatorPanel/browserEmulator.ts` | +2/−2 | **+472/−62** | низкая (правка Ивана механическая) |
| `.gitignore` | +1/−1 | +14/−24 | тривиальная |
| `src/version.json` | +1/−1 | +1/−1 | тривиальная — берётся версия Гусейна |

### 5.1. Характер правок Ивана в категории C

В 14 из 19 файлов правка **механическая и однотипная**: разрыв прямой зависимости UI → API,
то есть ровно требование п.20 ТЗ.

```diff
-import * as API from '../../API'
+import { backendGateway } from '../../platform/adapters/LegacyBackendGateway'
-      API.getCar(driver.c_id)
+      backendGateway.getCar(driver.c_id)
```

Такая правка воспроизводится на актуальном коде Гусейна вручную, независимо от расхождения файла.

### 5.2. `src/pages/Driver/Map.tsx` — главная точка

Единственный файл, требующий содержательного проектирования. Что делает Иван:

- убирает `import * as API`, подключает `useDriverHudSurface()` и `useMapSurface({ mockEnabled, setOrderCardModal })`;
- монтирует шлюз: `driverMapGateway.mount()` + `driverMapGateway.subscribe(event => …)` с размонтированием в cleanup;
- источник заказов — Snapshot: `driverPresentation.available ? … : …` вместо чтения из Redux;
- действия водителя идут через шлюз:
  `API.setOrderState(b_id, Arrived)` / `API.arrivedVotingOrder` → `driverMapGateway.arrive(b_id, Boolean(b_voting))`,
  `setOrderState(Started)` → `driverMapGateway.start(b_id)`,
  `setOrderState(Finished)` → `driverMapGateway.finish(b_id)`,
  `API.reverseGeocode` → `driverMapGateway.reverseGeocode`,
  `API.makeRoutePoints` → `driverMapGateway.makeRoutePoints(from, to, wayGraph)`,
  плюс `driverMapGateway.requestAreas([…])` и `driverMapGateway.openCard(b_id)`.

Со стороны Гусейна в этом же файле — +1874/−1509: эмулятор маршрута, позиция водителя, фазы поездки,
прибыльность, логирование решений по заказу. **Всё это сохраняется**, PI-поток накладывается сверху.

**Внимание:** версия `Map.tsx` у Ивана использует `leaflet.markercluster`, а Гусейн эту зависимость
из `package.json` удалил. `markercluster` не входит в дельту Ивана (это часть его старой базы),
поэтому при переносе он не должен попасть в результат. Базой файла берётся версия Гусейна — это
закрывает вопрос автоматически.

## 6. Инварианты, которые обязаны сохраниться

| Инвариант | Где живёт |
|---|---|
| `202 Accepted ≠ Command Completed` (п.11) | `FsmTaxiCommandTransport.ts`, `DriverMapGateway.ts` |
| сквозной `instanceId` (п.12) | `FsmTaxiCommandTransport.ts` → `DriverMapGateway.ts` → `DriverCommandCompletionWaiter.ts` |
| `schemaVersion`, `commandId`, `correlationId`, `Idempotency-Key` | `FsmTaxiCommandTransport.ts`, `interaction-contract/` |
| `COMPLETED / FAILED / TIMEOUT` | `DriverCommandCompletionWaiter.ts` |
| старый Query не перезаписывает новый WS Snapshot (п.10) | `SnapshotProvider.ts`, `ReconnectingSnapshotTransport.ts` |
| `SnapshotDriverCommandCompletionWaiter` сохраняется, серверный `GET /api/commands/{instanceId}` не реализуется (п.13) | `DriverCommandCompletionWaiter.ts` |

Покрытие тестами со стороны Ивана: 26 тестов в `src/platform/**/__tests__/`, в том числе
`DriverCommandCompletionWaiter.test.js`, `DriverMapGateway.test.js`, `FsmTaxiCommandTransport.test.js`,
`SnapshotProvider.test.js`, `ReconnectingSnapshotTransport.test.js`, `ReconnectingWebSocketClient.test.js`.

## 7. Legacy fallback (п.21)

Переключение реализовано через отсутствие конфигурации, а не через флаг: FSM-транспорты читают
`REACT_APP_FSM_API_URL`, `REACT_APP_FSM_API_TOKEN`, `REACT_APP_FSM_WS_URL`,
`REACT_APP_FSM_WS_TOKEN_QUERY_PARAM`, `REACT_APP_FSM_DRIVER_USER_ID`, `REACT_APP_FSM_ORDER_ID`,
`REACT_APP_FSM_DRIVER_POLL_MS`; отдельно `REACT_APP_PASSENGER_UI_FSM`. Если переменные не заданы,
транспорт не конфигурируется и работает legacy-путь. Механизм переносится как есть, ничего не удаляется.

## 8. Инфраструктура и проверки

Иван не менял `package.json` / `package-lock.json` / `tsconfig.json` / `.eslintrc.json` / `config/` / `scripts/`.
Единственное расхождение `package.json` — со стороны Гусейна: удалены `leaflet.markercluster`
и `@types/leaflet.markercluster` (см. п.5.2).

Тесты Ивана — `__tests__/*.test.js`. У Гусейна уже есть файлы того же паттерна
(`src/pages/Passenger/__tests__/uiFsm.test.js`), значит jest-конфигурация CRA их подхватит без правок.
После переноса: 16 существующих тестов + 26 PI-тестов.

Скриптов `lint` и `typecheck` в `taxi/package.json` нет. Критерии готовности п.25 выполняются так
(из каталога `taxi/`):

```
npx tsc --noEmit -p tsconfig.json
npx eslint "src/**/*.{ts,tsx}"
npm test
```

## 9. Предлагаемый порядок переноса

Коммиты режутся по архитектурным блокам, авторство Ивана — через `Co-Authored-By` и ссылку на SHA.

1. `src/platform/interaction-contract/` + `src/platform/map-channel/` — фундамент, зависимостей нет.
2. `src/platform/platform-interface/` — Runtime, Surface, Snapshot, Query, Realtime, navigation.
3. `src/platform/adapters/` — Legacy*Gateway, Fsm*Transport, `DriverMapGateway`, `DriverCommandCompletionWaiter`.
4. Категория B — 12 файлов, `git apply --3way`.
5. Категория C, лёгкая часть — 16 файлов с механической заменой `API.*` → `backendGateway.*`.
6. `src/pages/Driver/Map.tsx` — отдельным коммитом, ручное объединение.
7. `taxi/docs/**` — 18 документов.
8. Прогон `tsc` / `eslint` / `npm test`, архитектурная проверка п.20, PR → `main`, ревью Ивана.

Шаги 1–3 (188 файлов из 237 затронутых) выполняются механически. Шаг 6 — единственный,
где нужны проектные решения.

---

# Результат интеграции

Ветка `integration/platform-interface`, 9 коммитов.

## Сверка количества файлов

В первой редакции этого документа и в описании PR фигурировали три разных числа —
132, 133 и 134. Они означают разные вещи; ниже единственная проверяемая расшифровка.

| Число | Что означает | Как проверить |
|---|---|---|
| **134** | размер архитектурной дельты Ивана: сколько файлов он затронул относительно своей же базы `03c7af2`. Это объём **анализа**, а не объём PR | `git diff --name-status 03c7af2 ivan/main \| wc -l` → 134 (103 добавленных + 31 изменённый) |
| **132** | файлы, реально изменённые интеграцией относительно `main` | `git diff --name-only main HEAD` минус отчёт |
| **133** | **изменённых файлов в PR** — то, что показывает GitHub | `git diff --name-only main HEAD \| wc -l` → 133 |

Арифметика: `103 новых + (31 − 2) изменённых = 132`, плюс сам `PI_INTEGRATION_MAP.md` = **133**.

**Почему 134 → 132.** Два файла из дельты Ивана сознательно оставлены в версии Taxi
по Приоритету №1 ТЗ, поэтому чистого изменения не дали:

- `.gitignore` — правка Ивана `+1/−1`, версия Taxi `+14/−24` и новее;
- `src/version.json` — версия Taxi.

Оба разобраны, а не пропущены: они отнесены к категории C (ручное объединение) и
разрешены в пользу Taxi. Формулировка «покрытие дельты 134/134» означает, что все
134 файла дельты **разобраны и учтены**, а не что все 134 попали в diff PR.

**Одно число для приёмки PR: 133 изменённых файла** — ровно столько показывает GitHub.

## Состав

| Коммит | Блок | Файлов |
|---|---|---|
| `32d9150` | Interaction Contract + Map Channel | 18 |
| `71c542f` | Platform Interface: Runtime, Surfaces, Snapshot, Query, Realtime | 44 |
| `f0adff0` | Adapters: Command API, Completion Waiter, gateways | 23 |
| `ed3b60c` | 12 файлов UI, где версия Taxi совпадала с базой Ивана | 12 |
| `9f02fa4` | 16 файлов ручного объединения | 16 |
| `d076858` | `Driver/Map.tsx` + сопутствующее | 3 |
| `8ac31fe` | Документация | 18 |
| `cf77872` | Карта переноса и отчёт | 1 |
| `3f97d0a` | BLOCKER-1: защита Order Snapshot от устаревших Query/WS | 2 |

Сумма по коммитам: 18 + 44 + 23 + 12 + 16 + 3 + 18 + 1 + 2 = **137**. Четыре файла
изменены двумя коммитами каждый — `Driver/index.tsx` и `Passenger/index.tsx`
(в `9f02fa4` и `d076858`), `FsmOrderSnapshotTransport.ts` и его тест
(в `f0adff0` и `3f97d0a`). 137 − 4 = **133** уникальных файла в PR.

## Проверки

| Проверка | Результат |
|---|---|
| TypeScript | 0 ошибок (452 файла) |
| eslint | 14 ошибок против 17 на `main` — новых нет, 3 исправлено |
| тесты | 42/42 набора, **310/310** теста |
| разбор дельты Ивана | 134/134 файла (132 в diff, 2 разрешены в пользу Taxi) |
| `src/platform/**` и `docs/**` | как в источнике, кроме `FsmOrderSnapshotTransport` — см. BLOCKER-1. Публичные contracts не изменены |

Прогон локальный. GitHub Actions в репозитории не настроены, поэтому независимого
CI-подтверждения у этих чисел нет — это результат автора PR. Команды для
воспроизведения (из каталога `taxi/`):

```
npx tsc --noEmit -p tsconfig.json
npx eslint "src/**/*.{ts,tsx}"
CI=true NODE_OPTIONS=--openssl-legacy-provider node scripts/test.js --watchAll=false
```

## Правки по ревью Ивана

### BLOCKER-1 — защита Order Snapshot от устаревших Query/WS (`3f97d0a`)

Замечание принято полностью. `FsmOrderSnapshotTransport.mapSnapshot()` поднимал
локальный revision через `Math.max(this.revision + 1, server.revision)`, то есть
счётчик рос при любом пришедшем snapshot независимо от его серверного revision.
Откат состояния был реально возможен.

Перенесена та же защита, что уже была в `FsmDriverSnapshotTransport`:

- `lastServerRevision` / `lastServerUpdatedAt` — решение по серверным данным,
  а не по локальному счётчику;
- `querySequence` / `lastAcceptedQuerySequence` — более поздний принятый Query
  отменяет более ранний;
- `realtimeEpoch` — Query, отправленный до WS-события и вернувшийся после него,
  отбрасывается, даже если его revision выше;
- при отсутствии `revision` сравнение по `updatedAt`;
- устаревший Query возвращает последний принятый snapshot, а не ошибку;
  `FSM_ORDER_STALE_SNAPSHOT` — только если принятого snapshot ещё нет.

Публичный контракт PI не менялся: `DomainSnapshotTransport`, сигнатуры
`loadSnapshot` / `subscribeSnapshots` и форма `PlatformSnapshotInput` прежние.

### HIGH — adversarial-тесты (`3f97d0a`)

Добавлено 6 случаев в `FsmOrderSnapshotTransport.test.js`:

| Случай | Барьер |
|---|---|
| WS старше принятого → игнорируется | `lastServerRevision` |
| WS с тем же revision → игнорируется | `lastServerRevision` (`<=`) |
| Query старше принятого WS → игнорируется | `lastServerRevision` |
| Query, обогнанный WS за время запроса → отбрасывается | `realtimeEpoch` |
| сравнение по `updatedAt` при отсутствии `revision` | `lastServerUpdatedAt` |
| после отброшенного устаревшего более новый принимается | защита не залипает |

Проверено, что тесты ловят исходный дефект: на прежней реализации падают все 6,
на исправленной проходят все 12 тестов набора.

### BLOCKER-2 — сверка чисел

См. раздел «Сверка количества файлов» выше. Приведено к одному числу: **133**.

## Архитектурная проверка (п.20)

| Обход | Статус |
|---|---|
| `Map → API` | нет |
| `Surface → backend endpoint` | нет |
| `UI → direct Command API` | нет |
| Passenger Channel → `state/` | нет (проверяется `PassengerChannelBoundary.test.js`) |

Единственный оставшийся прямой вызов бэкенда из UI — `DriverTripCancelModal.tsx`
(`API.cancelDrive`). Это файл Taxi, которого разработка Ивана не касалась;
путь не новый, поэтому в рамках переноса не менялся. Кандидат на перевод
на `passengerGateway.cancelOrder` отдельной задачей.

## Решения, вынесенные на ревью Ивана

1. **`src/tools/markerMock.ts` не перенесён.** 356 строк демо-мока дизайн-системы
   маркера из старой базы Ивана. PI от него не зависит — `MapSurface` принимает
   `mockEnabled: boolean`, здесь он равен `false`. Мок-режимом в основном
   репозитории остаётся эмулятор водителя. `docs/MOCK_MODE.md` перенесён как есть.

2. **Подписка на события `DriverMapGateway` в `Map.tsx` частичная.** Обрабатываются
   `CardOpened`, `AreasRequested`, `Failed`. `Arrived` / `Started` / `Finished` — нет:
   обновление состояния после перехода принадлежит обработчикам карты
   (`runMapOrderTransition`, `refreshMapOrderState`, продолжение плана поездки),
   и дублирование означало бы двойной `getOrder`. Промис шлюза резолвится после
   терминального результата команды, поэтому порядок верен в обоих режимах.

3. **`Failed` логируется без модалки.** Карта сознательно не блокирует
   поездку окном ошибки — демо-бэкенд отвечает шумом и на успешный переход.

4. **`onVotingWentClick`** в `CardModal.tsx` и `Order/index.tsx` выражен одним
   вызовом `driverMapGateway.arrive({ voting, updateState, tolerateNotAppointed })`.
   Ранее `setOrderState(Arrived)` не был tolerant к `NotAppointedPerformer`,
   шлюз распространяет допуск на оба вызова. Для водителя поведение не меняется.

5. **`LegacyRouteProvider` оставлен в версии Ивана.** Попытка делегировать его в
   `tools/route.ts` (единый источник геометрии маршрута) замыкает цикл
   импортов `API → localization → state → localization` и роняет 3 набора тестов.
   Дедупликация — отдельная задача.

6. **Имена, оставленные за версией Taxi:** `refuseVotingOrder` (вместо
   `cancelVotingDeparture`), `onVotingRefuseOrder` (вместо `onVotingCancelDeparture`) —
   используются в JSX.

## Осталось сделать

- повторное ревью Ивана по п.22 ТЗ;
- финальный merge выполняет Гусейн.
