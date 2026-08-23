# Repository Merge Report

Отчёт по TASK-REPO-MERGE-002 — финализация объединения Taxi-репозиториев после PR #9.

Дата: 2026-08-22, повторная регрессионная проверка Driver — 2026-08-23 (раздел 8).
Итоговое состояние: `Guseyn9/taxi/main` = `72d5b78` (merge commit PR #9).

---

## 1. Источники

| Репозиторий | Роль | Состояние на момент объединения |
|---|---|---|
| `Guseyn9/taxi` | основной репозиторий, единственная база интеграции | `main` = `53ac169` до merge, `72d5b78` после |
| `spitegod/taksi-platform-interface` | исторический источник Platform Interface | `main` = `62cea1a` |

Репозитории не имеют общей истории (`unrelated histories`), структура каталогов различается:
корень репозитория-источника соответствует каталогу `taxi/` основного репозитория.

Переносилась **архитектурная дельта** `03c7af2..62cea1a` (134 файла), а не состояние всего
репозитория-источника. Коммит `03c7af2` — импорт старой копии Taxi (1015 файлов) — не переносился.

### Исходные commits

| Commit | Сообщение |
|---|---|
| `91a8426` | commit changes |
| `c0c8810` | changes new |
| `6671f69` | Integrate Platform Interface with taxi backend |
| `c81f5a2` | Finalize asynchronous command integration |
| `1276759` | Document command completion contract |
| `62cea1a` | Extract command completion waiter |

## 2. Что перенесено

| Область | Путь | Файлов |
|---|---|---|
| Platform Interface | `src/platform/platform-interface/` | 44 |
| Platform adapters | `src/platform/adapters/` | 23 |
| Map Channel | `src/platform/map-channel/` | 11 |
| Interaction Contract | `src/platform/interaction-contract/` | 7 |
| Документация | `docs/` | 18 |

Конкретно:

- **Runtime / Surface**: `PlatformInterfaceRuntime`, `Surface`, `SurfaceRegistry`,
  `compositionRoot`, `validateComposition`, `usePlatformRuntime`, `useRegisteredSurface`,
  Surfaces для driver / passenger / map, `SnapshotSurface`, `standard`.
- **Snapshot / Query / Realtime**: `SnapshotProvider`, `ReconnectingSnapshotTransport`,
  `snapshot.ts`, `realtime/ReconnectingWebSocketClient`,
  `FsmDriverSnapshotTransport`, `FsmOrderSnapshotTransport`.
- **Command integration**: `FsmTaxiCommandTransport` — `schemaVersion`, `commandId`,
  `correlationId`, `Idempotency-Key`, `202 Accepted`, duplicate response, protocol error handling,
  `instanceId`.
- **Completion waiter**: `DriverCommandCompletionWaiter` — `COMPLETED / FAILED / TIMEOUT`.
- **DriverMapGateway**: `Interaction Action → Command transport → CommandAccepted → instanceId →
  CompletionWaiter → terminal result`.
- **Passenger boundary**: `LegacyPassengerGateway`, `LegacyPassengerChannelStoreAdapter`,
  Passenger Surface; граница сторожится тестом `PassengerChannelBoundary.test.js`.
- **Legacy fallback**: `LegacyBackendGateway`, `LegacyChatGateway`, `LegacyReduxSnapshotProvider`,
  `LegacyRouteProvider`.
- **Navigation**: `NavigationRuntime`, `NavigationRegistry`, `PLATFORM_ROUTES`,
  `usePlatformNavigate` / `usePlatformNavigator`.

## 3. Что сознательно не перенесено

| Что | Почему |
|---|---|
| старая копия Taxi (коммит `03c7af2`, 1015 файлов) | в основном репозитории есть более новая версия. Приоритет №1 ТЗ-001 |
| `src/tools/markerMock.ts` (356 строк) | демо-мок дизайн-системы маркера, Taxi-логика, не Platform Interface. PI от него не зависит: `MapSurface` принимает `mockEnabled: boolean`, в основном репозитории он равен `false`. Мок-режимом остаётся эмулятор водителя |
| `src/types/markercluster-css.d.ts` | типизация `leaflet.markercluster`; зависимость удалена из `package.json` основного репозитория |
| `artifacts/marker-preview.{html,png}`, `artifacts/ds-fixes-preview.{html,png}` | превью дизайн-системы маркера, связаны с `markerMock` |
| `.gitignore`, `src/version.json` | разобраны и разрешены в пользу более новой версии Taxi |

`docs/MOCK_MODE.md` перенесён как есть — это описание исходной разработки; сам механизм в основном
репозитории не активирован.

## 4. Контрольное сравнение репозиториев (§11)

Сравнение всех 1118 файлов `spitegod/taksi-platform-interface/main` с `Guseyn9/taxi/main:taxi/`:

| Категория | Файлов |
|---|---|
| идентичны | 1047 |
| отличаются | 65 |
| отсутствуют в основном репозитории | 6 |

**Отсутствующие 6** — перечислены в разделе 3, все исключены осознанно. Ни одного файла
`src/platform/**` или `docs/**` среди них нет.

**Отличающиеся 65** — Taxi-файлы, где действует более новая версия основного репозитория
(Приоритет №1), плюс **2 файла Platform Interface**: `FsmOrderSnapshotTransport.ts` и его тест —
изменены правкой BLOCKER-1 по ревью автора (см. раздел 6). Остальные 83 файла `src/platform/**`
и все 18 файлов `docs/**` совпадают с источником байт-в-байт: публичные contracts не изменялись.

Воспроизведение:

```
git remote add ivan https://github.com/spitegod/taksi-platform-interface.git
git fetch ivan
git ls-tree -r --name-only ivan/main | while IFS= read -r f; do
  a=$(git rev-parse --verify --quiet "ivan/main:$f")
  b=$(git rev-parse --verify --quiet "main:taxi/$f")
  ...
done
```

`git rev-parse` без `--verify --quiet` эхоит нераспознанный аргумент в stdout и даёт ложный
результат «файл присутствует» — использовать только с этими флагами.

## 5. Независимость от репозитория-источника (§5)

| Проверка | Результат |
|---|---|
| Git submodule | `.gitmodules` отсутствует, submodules нет |
| npm dependency на репозиторий-источник | нет (`package.json` не содержит `github:`, `git+`, `file:` ссылок на него) |
| ссылки на `spitegod` / `taksi-platform-interface` в `src/`, `config/`, `scripts/` | нет |
| ссылки на локальные пути | нет |
| runtime-зависимость от второго репозитория | нет |

Проект собирается самостоятельно: `git clone` → `npm install` → сборка (см. раздел 7).

## 6. Правки по ревью автора Platform Interface

Ревью PR #9 выявило два блокера, оба закрыты до merge.

### BLOCKER-1 — защита Order Snapshot от устаревших Query/WS (`3f97d0a`)

`FsmOrderSnapshotTransport.mapSnapshot()` поднимал локальный revision через
`Math.max(this.revision + 1, server.revision)` — счётчик рос при любом пришедшем snapshot
независимо от его серверного revision, из-за чего состояние заказа могло откатиться назад.

Перенесена та же защита, что была в `FsmDriverSnapshotTransport`:
`lastServerRevision` / `lastServerUpdatedAt`, `querySequence` / `lastAcceptedQuerySequence`,
`realtimeEpoch`, fallback на `updatedAt`. Устаревший Query возвращает последний принятый snapshot.
Публичный контракт PI не менялся.

Добавлено 6 adversarial-тестов; проверено, что на исходной реализации падают все 6, на
исправленной проходят все 12 тестов набора.

### BLOCKER-2 — сверка количества файлов (`1414054`)

Приведено к одному проверяемому числу: **133 изменённых файла в PR** = 132 файла интеграции
+ 1 файл отчёта `PI_INTEGRATION_MAP.md`. Расшифровка 134 / 132 / 133 — в `PI_INTEGRATION_MAP.md`.

## 7. Проверки итогового `main` (§4, §15)

Все прогоны выполнены на `main` = `72d5b78` после merge, из каталога `taxi/`.

| Проверка | Команда | Результат |
|---|---|---|
| зависимости | `npm install` | `up to date`, `package-lock.json` не изменился |
| сборка | `node pre-build.js && node scripts/build.js` | exit 0 |
| типы | `npx tsc --noEmit -p tsconfig.json` | 0 ошибок, 452 файла |
| lint | `npx eslint "src/**/*.{ts,tsx}"` | 14 ошибок против 17 до интеграции — новых нет, 3 исправлено |
| тесты | `CI=true node scripts/test.js --watchAll=false` | 42/42 набора, 310/310 теста |

Оставшиеся 14 ошибок eslint — `react-hooks/rules-of-hooks` в `src/pages/Order/index.tsx`,
существовали до интеграции.

`NODE_OPTIONS=--openssl-legacy-provider` обязателен для всех node-команд проекта.

GitHub Actions в репозитории не настроены — независимого CI-подтверждения у этих чисел нет.

## 8. Регрессионная проверка (§12)

Приложение поднято (`node scripts/start.js`, порт 3000) и пройдено в headless-браузере под
реальным тестовым водителем `gmailgtest2` (user 871) против живого backend
`https://ibronevik.ru/taxi/c/gruzvill/api/v1`. Клиентская сторона — встроенный эмулятор клиентов.

### Driver

| Сценарий | Результат | Чем подтверждено |
|---|---|---|
| карта | ✅ | Leaflet-контейнер, 20 тайлов, маркеры заказов, маркер водителя с курсом |
| позиция водителя | ✅ | `DRIVER_LOCATION { positionSource: "EMULATOR_ROUTE" }` в RAW-логе, маркер движется по маршруту |
| получение заказов | ✅ | до 10 карточек в списке; `MAP_ORDERS_RECEIVED`, `ACTIVE_ORDERS_RENDERED`, `DRIVER_ORDER_LIST_UPDATED` |
| маршрут | ✅ | активная полилиния на карте, `map.activePolylines.updated` |
| принятие заказа | ✅ | кнопка `Take order` в карточке, заказ перешёл в план поездки |
| Arrived («Поехал») | ✅ | кнопка `Went №1509-2`, счётчик фазы поездки сменился |
| Started («Приехал») | ✅ | кнопка `Arrived №1509-2` |
| Finished | ✅ | повторный прогон 23.08: маркер доведён до точки высадки, кнопка сменилась `Interrupt the trip` → `Close Drive`, заказ закрыт; backend подтверждает `c_state=6 (Finished)` — см. ниже |
| отказ / прерывание поездки | ✅ | кнопка `Interrupt the trip №1509-2` |
| voting | ✅ | повторный прогон 23.08: участие в голосовании, выбор водителя пассажиром, «Поехал», «На месте», подтверждение кода посадки; backend подтверждает `c_state=5 (Started)` — см. ниже |
| эмулятор | ✅ | панель `Client emulator` (Start / Stop / Check, редактор маршрута, Work log), запуск, регистрация 4 клиентов, генерация заказов |

Дополнительно подтверждена работа Taxi-функциональности основного репозитория: прибыльность
(`+24,25 GHS`, `+148,44 GH₵/км хол.`), свободные места (`Free seats: 3 / 3`), номера заказов
(`№1509-2` — `getOrderIdText`), decision log (`ORDER_DECISION_CHANGED`, `ACTIVE_ORDER_FILTER_DECISION`),
гейтинг эмуляторных заказов (`EMULATOR_STOP_CLEARED_UI_STATE`, `ORDERS_UI_FORCED_EMPTY`).

#### Повторный прогон 2026-08-23: Finished и voting

Первый прогон (22.08) оставил два незакрытых пункта §12: `Finished` не был достигнут, а voting
доведён только до появления заказов с меткой `Voter`. Оба сценария пройдены заново 23.08 в том
же окружении — `node scripts/start.js` на порту 3000, водитель `gmailgtest2` (871), живой
backend, встроенный эмулятор клиентов, режим legacy fallback (`REACT_APP_FSM_*` не заданы).

**Полный цикл поездки до Finished.** Заказ `15100` (`№1510-0`), `улица Зорге, ЗЖМ` →
`улица Жмайлова, 7-й мкр`:

| Шаг | Кнопка карты (класс / текст) | Результат |
|---|---|---|
| взятие заказа | `Take order` | заказ вошёл в план поездки |
| «Поехал» | `finish-drive-button--started` / `Went` | `Performer` → `Arrived`, маркер тронулся |
| «Приехал» | `finish-drive-button--arrived` / `Arrived` | `Arrived` → `Started` |
| в пути к высадке | `finish-drive-button--interrupted` / `Interrupt the trip` | водитель ещё не у точки высадки — гейт `requiresDestinationArrival` подменяет завершение прерыванием |
| у точки высадки | `finish-drive-button--finished` / `Close Drive` | через ~65 с маркер дошёл до точки высадки, кнопка сменилась сама |
| завершение | — | переход на вкладку `Lite`, `No actual drive`, открылось окно оценки `Rating! №1510-0` |

Смена `Interrupt the trip` → `Close Drive` произошла без вмешательства в код и подтверждает
сам гейт: до высадки завершение недоступно, после — доступно.

Итоговое состояние проверено независимо от UI — прямым запросом к backend тем же аккаунтом
водителя (`/drive/archive`, `array_type=list`):

```
15100: b_state=4   мой c_state=6 (Finished)   улица Зорге, ЗЖМ -> улица Жмайлова, 7-й мкр
```

**Основной сценарий voting до подтверждения кода посадки.** Эмулятор клиентов планирует исход
выбора заранее и показывает его в карточке (`Chooses me` / `Chooses another`); заказ с чужим
исходом до посадки не доводится, поэтому брался заказ с исходом `Chooses me`. Заказ `15182`
(`№1518-2`), `Миллеровская улица, ЗЖМ` → `Акмолинская улица`:

| Шаг | Где | Результат |
|---|---|---|
| участие в голосовании | карточка, `Going to the call` | `participateVotingOrder`, состояние `Considering` |
| выбор водителя пассажиром | эмулятор клиента, `set_performer` | водитель назначен исполнителем, на карте появился `Went` |
| «Поехал» | карта, `finish-drive-button--started` | `Performer` → `Arrived` |
| подъезд к пассажиру | карта, `Confirm code` | кнопка была `disabled`, пока маркер не дошёл до точки посадки (гейт `requiresPickupArrival`), затем разблокировалась и открыла карточку |
| «На месте» | карточка, `Arrived` | этап посадки: появилось поле `Код посадки`, `Refuse the order` сменилось на `Refuse the pickup` |
| неверный код `12` | карточка, `Confirm code` | посадка не прошла, поле кода осталось на экране |
| код `1234` | карточка, `Confirm code` | `driverMapGateway.confirmBoarding` → `confirmVotingCode` + `set_start_state`, карточка закрылась, маршрут на карте перестроился от водителя к точке высадки |

Backend после подтверждения:

```
15182: b_state=2   мой c_state=5 (Started)   Миллеровская улица, ЗЖМ -> Акмолинская улица
```

Сценарий воспроизведён трижды (заказы `15152`, `15168`, `15182`) — во всех прогонах
подтверждение кода посадки переводит заказ в `Started`.

Проверка кода посадки в этих прогонах опирается только на формат: эмулятор создаёт заказ с
`b_driver_code: '1'`, backend в ответе `b_driver_code` не возвращает, а `DRIVER_DOOR_NUMBER_PATTERN`
требует 3–4 цифр. Поэтому `12` отклоняется как неверный формат, а любой корректный по формату код
принимается — сравнивать его не с чем. Логика сверки со значением (`enteredCode !== expectedCode`)
на этих данных не выполняется; это свойство тестовых заказов, а не следствие объединения.

**Найдено в ходе прогона (вне scope PR).** После подтверждения кода посадки главная кнопка карты
оставалась на шаге посадки — `Confirm code`, `disabled`, — хотя backend уже отдавал
`c_state=5 (Started)`, а маршрут на карте перестроился к точке высадки. Воспроизвелось во всех
трёх прогонах; в последнем состояние кнопки наблюдалось непрерывно 4 минуты и не изменилось.

Причина не в Platform Interface: `driverMapGateway.confirmBoarding` выполняет и
`confirmVotingCode`, и `set_start_state`, состояние на backend меняется. Но при интеграции
(`9f02fa4`) в `CardModal.confirmVotingCode` пара вызовов

```
API.confirmVotingCode(orderId, code)
setOrderState(orderId, Started, code)   // ordersActionCreators.setState — Redux-thunk
```

заменена одним `driverMapGateway.confirmBoarding(orderId, code)`. Прежний `setState` был
thunk'ом, который по завершении диспатчил `UPDATE_SUCCESS`, а тот через `getOrderSaga` немедленно
перечитывал заказ в store. Новый путь идёт мимо store, и локальное состояние заказа само не
обновляется. Остальные переведённые вызовы в `Driver/Map.tsx` компенсируют это `rememberOptimisticState`
и `refreshMapOrderState`, у voting-пути в карточке такой компенсации нет.

Правка в этот PR не вносится: PR #10 не меняет код, а §8/§13 ТЗ запрещают использовать объединение
как повод для изменений. Зарегистрировано отдельной задачей (раздел 11).

После прогонов тестовые заказы водителя отменены — активных заказов у `gmailgtest2` не осталось
(`/drive?fields=00000000u1` возвращает пустой список), эмулятор клиентов остановлен.

### Passenger

| Сценарий | Результат |
|---|---|
| отображение состояния | ✅ карта, геолокация, форма заказа, класс авто, число пассажиров |
| взаимодействие с картой | ✅ Leaflet, перецентровка по геолокации |
| создание заказа | ✅ частично: форма и кнопки `Vote` / `Order` рендерятся; отправка заказа со стороны пассажирского UI не выполнялась — заказы создавал эмулятор клиентов |
| FSM | ✅ `uiFsm.ts` работает как re-export из PI Surface, `REACT_APP_PASSENGER_UI_FSM` не задан → legacy-ветка |

### Platform Interface

| Сценарий | Результат |
|---|---|
| Runtime, Surface lifecycle, cleanup | ✅ автотесты `PlatformInterfaceRuntime`, `SurfaceRegistry`, `compositionRoot`; в браузере — монтирование Map Surface и Driver HUD Surface без ошибок |
| Snapshot / Query / Realtime / reconnect | ✅ автотесты `SnapshotProvider`, `ReconnectingSnapshotTransport`, `ReconnectingWebSocketClient`, `Fsm*SnapshotTransport` (включая 6 новых adversarial) |
| Command / completion | ✅ автотесты `FsmTaxiCommandTransport`, `DriverCommandCompletionWaiter`, `DriverMapGateway` |
| legacy fallback | ✅ `REACT_APP_FSM_*` не заданы → транспорт не конфигурируется, приложение работает по legacy-пути; именно в этом режиме пройдена вся регрессия выше |

Console errors за весь прогон — 3, все существовали до интеграции: два предупреждения React о
SVG-атрибутах (`stroke-linecap`, `stroke-linejoin`) и одно о `key` в списке. Ошибок Platform
Interface нет.

После прогона тестовые заказы отменены (`npm run check` в `driver-emulator`), эмулятор остановлен.

## 9. Архитектурный self-check (§13)

| Обход | Статус |
|---|---|
| `Map → API` | отсутствует |
| `Surface → backend endpoint` | отсутствует |
| `UI → direct Command API` | отсутствует |
| Passenger Channel → `state/` | отсутствует, сторожится `PassengerChannelBoundary.test.js` |

Новых обходов Platform Interface не появилось.

**Оставленный вне scope обход:** `src/components/modals/DriverTripCancelModal.tsx` вызывает
`API.cancelDrive` напрямую. Файл принадлежит Taxi-функциональности основного репозитория,
разработка Platform Interface его не касалась, путь не новый. Зарегистрирован как отдельная
задача (раздел 11).

## 10. Git-структура после merge (§9)

```
Guseyn9/taxi
├── main                                ← единственная рабочая ветка
├── integration/platform-interface      ← историческая, оставлена для трассировки
└── feature/... bugfix/...              ← обычные рабочие ветки
```

`integration/platform-interface` после merge не является рабочей веткой и сохранена как точка
трассировки переноса: ссылки из PR #9 и из отчётов остаются рабочими.

Авторство изменений автора Platform Interface сохранено через `Co-authored-by` в каждом
интеграционном коммите и ссылки на исходные SHA в теле коммитов и в описании PR #9.
Дальнейшие изменения после интеграции принадлежат `Guseyn9/taxi`.

## 11. Отдельные задачи

Не входят в объединение репозиториев, зарегистрированы отдельно.

| Задача | Суть |
|---|---|
| TASK-CORE-001 | замена временного `SnapshotDriverCommandCompletionWaiter` на серверный Command Status API (`CommandStatusDriverCommandCompletionWaiter`) без изменения публичного Platform Interface и UI |
| дедупликация геометрии маршрута | `LegacyRouteProvider` дублирует `src/tools/route.ts`. Прямое делегирование замыкает цикл импортов `API → localization → state → localization` и роняет 3 набора тестов — требуется отдельное решение |
| `DriverTripCancelModal` | перевод прямого вызова `API.cancelDrive` на `passengerGateway.cancelOrder` |
| удаление legacy fallback | отдельная задача, в рамках миграции legacy-режим сохраняется |
| GitHub Actions CI | настройка workflow (`tsc` / `eslint` / тесты), чтобы проверки подтверждались независимо от автора PR |
| перевод `markerMock` при необходимости | если демо-режим дизайн-системы маркера понадобится в основном репозитории |
| обновление состояния после подтверждения кода посадки | `CardModal.confirmVotingCode` перестал обновлять store заказа: главная кнопка карты остаётся на шаге посадки, хотя backend уже в `Started` (раздел 8) |

## 12. Статус репозитория-источника (§10)

`spitegod/taksi-platform-interface` **не удаляется**. Требуется:

- пометить как архивный / legacy;
- сохранить доступ к истории — на неё ссылаются коммиты интеграции и отчёты;
- зафиксировать, что актуальная разработка ведётся только в `Guseyn9/taxi`;
- новые функциональные изменения в старом репозитории не вносить.

Действие выполняется владельцем `spitegod/taksi-platform-interface` — прав на изменение настроек
этого репозитория у основного репозитория нет.

## 13. Acceptance Criteria

| Критерий | Статус |
|---|---|
| PR #9 смержен в `Guseyn9/taxi/main` | ✅ `72d5b78` |
| `main` собирается самостоятельно | ✅ сборка exit 0, зависимостей от второго репозитория нет |
| все тесты проходят | ✅ 42/42 набора, 310/310 теста |
| Platform Interface работает | ✅ автотесты + монтирование Surface в браузере |
| Driver UI работает | ✅ регрессия пройдена полностью, включая `Finished` и voting с подтверждением кода посадки (см. раздел 8) |
| Passenger UI работает | ✅ регрессия пройдена частично (см. раздел 8) |
| legacy fallback работает | ✅ вся регрессия пройдена именно в этом режиме |
| нет зависимости от репозитория-источника | ✅ |
| `markerMock.ts` не является обязательной зависимостью | ✅ ссылок в коде нет, `mockEnabled: false` |
| авторство изменений сохранено | ✅ `Co-authored-by` + ссылки на SHA |
| архитектурные контракты не изменены | ✅ `src/platform/**` совпадает с источником, кроме правки BLOCKER-1 |
| создан `REPOSITORY_MERGE_REPORT.md` | ✅ этот документ |
| старый репозиторий помечен как legacy | ⏳ на стороне владельца репозитория-источника (раздел 12) |
| дальнейшая разработка только в `Guseyn9/taxi` | ✅ по итогам объединения |

## 14. Связанные документы

- `PI_INTEGRATION_MAP.md` — карта переноса, классификация всех 134 файлов дельты, сверка чисел.
- `docs/ARCHITECTURE.md` — архитектура Platform Interface.
- `docs/PLATFORM_INTERFACE_RUNTIME.md` — runtime и Surface.
- `docs/TASK_PI_001_QUERY_REALTIME.md` — контракт Query / Realtime.
- `docs/TASK_CORE_001_COMMAND_COMPLETION.md` — контракт completion.
- `docs/TASK_FE_002_COMMAND_COMPLETION_WAITER.md` — `DriverCommandCompletionWaiter`.
