# 13. Passenger Surface: advertised actions, feature flag and actual command execution

## 1. База

Проверен только main baseline `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`. Локальная QA-версия и экспериментальная ветка не используются. Это статический source audit; runtime deployment env и конкретный серверный snapshot payload не получены.

## 2. Уточнение к этапу 12: availableActions — прежде всего UI metadata

В `LegacyReduxSnapshotProvider.resolveAvailableActions` набор действий вычисляется по производному PassengerUiState. `PassengerSurface.resolve` читает этот список и использует его для фильтрации видимых блоков:
- CancelOrder управляет `cancelButton` и `showCancel`;
- SelectCandidate / AcceptOffer управляют `candidateList`;
- OpenChat управляет `chatButton` и `showChat`;
- CreateIncident управляет `sosButton`.

В самом `PassengerSurface` нет метода dispatch/execute. Он возвращает presentation config и availableActions. Поиск по выбранному source не обнаружил вызовов `runtime.dispatch` для `PASSENGER_ACTIONS.AcceptOffer`, `OpenChat`, `ConfirmBoarding`, `CreateIncident` или `RateOrder` из Passenger UI.

Поэтому формулировку этапа 12 об «отсутствующих terminal events при неподдержанном dispatch» следует считать условным риском самого Gateway, а не установленным текущим пользовательским дефектом: факт dispatch этих пяти action types не установлен.

## 3. API-13-01 — UI FSM feature flag включает presentation, но не заменяет command path

В `src/pages/Passenger/fsmFeature.ts`:
- `localStorage.feature.passenger_ui_fsm = '1'` включает UI FSM;
- значение `'0'` отключает его и имеет приоритет над env;
- иначе читается `REACT_APP_PASSENGER_UI_FSM === '1'`.

В `Passenger/index.tsx` результат используется для выбора `effectivePassengerUiConfig`. Если флаг выключен, `VotingForm` получает `undefined` и использует legacy presentation path. Если включён, UI применяет Surface-derived visibleBlocks/config.

Вызовы мутаций при этом по-прежнему выполняются напрямую через `passengerGateway` из `VotingForm`, `PassengerLiveOrder` и модальных компонентов. Флаг не переключает `LegacyPassengerGateway` на серверный Passenger Command API и не добавляет handlers для пяти перечисленных Action types.

**Вывод:** название «Passenger UI FSM» относится к presentation/state-driven UI, но не доказывает миграцию passenger command execution на серверный FSM. Не смешивать его с driver lifecycle FSM transport.

## 4. API-13-02 — Snapshot source может быть серверным, но это не равнозначно серверному Passenger Command API

В `App.tsx` provider выбирается при изменении пользователя:
- для Driver — configured FSM Driver Snapshot provider, если доступен;
- иначе — configured FSM Order Snapshot provider, если доступен;
- иначе — `LegacyReduxSnapshotProvider`.

Следовательно, для не-driver окружения серверный Order Snapshot может заменить legacy Redux provider при наличии конфигурации. Если server provider не сконфигурирован, passenger availableActions вычисляются локально из Redux order facts.

Но независимо от snapshot source, найденный `LegacyPassengerGateway` продолжает исполнять семь мутаций через legacy API. Источник read model и транспорт команд — отдельные оси архитектуры. Нельзя делать вывод «пассажирские команды на FSM» только по факту серверного Snapshot.

## 5. Реальные UI команды и пробелы

| Функция UI | Наблюдаемое выполнение | Комментарий |
|---|---|---|
| Создать заказ | `passengerGateway.createOrder → postDrive` | Legacy HTTP через PI adapter |
| Отменить заказ | `passengerGateway.cancelOrder → cancelDrive` или callback `onLockedCancel` | Для locked order основной экран открывает CancelModal; отмена не всегда выполняется из VotingForm напрямую |
| Выбрать кандидата | `passengerGateway.selectCandidate → chooseCandidate` | Реальные call sites в VotingForm, PassengerLiveOrder и модальных окнах |
| Принять Offer | Отдельный `AcceptOffer` action/handler не найден | Не приравнивать к SelectCandidate без подтверждения бизнес-контракта |
| Освободить кандидата | `passengerGateway.releaseCandidate → releaseCandidateChoice` | Несколько call sites |
| Продлить ожидание | `passengerGateway.updateWaitingTime → setWaitingTime` | Несколько call sites |
| Изменить цену клиента | `passengerGateway.updateCustomerPrice → updateOrderCustomerPrice` | Call site в VotingForm |
| Завершить поездку со стороны пассажира | `passengerGateway.completeRide → setOrderState(Finished)` | Call sites в VotingForm, PassengerLiveOrder и OnTheWayModal |
| Чат | Action OpenChat присутствует в metadata | Фактическая реализация чата находится в отдельном chat/channel flow; этот этап не доказывает, что кнопка не работает |
| Подтверждение посадки | Action ConfirmBoarding присутствует в metadata | Пассажирский код/подтверждение требует отдельной проверки UI и backend flow; не считать action handler реализованным в LegacyPassengerGateway |
| SOS/инцидент | Action CreateIncident используется для видимости sosButton | Отдельный incident command handler в LegacyPassengerGateway отсутствует; call site dispatch не найден |
| Рейтинг | `backendGateway.setOrderRating → API.setOrderRating` | Вызов из RatingModal обходит Passenger Action/Gateway |

## 6. Pilot implications

1. Не заявлять, что Passenger UI FSM равен миграции Passenger command layer на FSM.
2. Не считать пять metadata actions работающими серверными командами без отдельного доказательства их обработчиков.
3. Для каждого видимого блока проверить не только его видимость, но и фактический onClick/handler, endpoint, success/failure feedback.
4. Для server Snapshot отдельно проверить соответствие `availableActions` поддержанным командам и UI state; snapshot может быть серверным при сохранении legacy mutation path.
5. Для rating сохранить отдельный контроль: только stars передаются в API, комментарий/чаевые не подтверждены как сохраняемые.

## 7. Тестовая матрица

| Проверка | Что должна доказать |
|---|---|
| Feature flag off | Legacy presentation; команды остаются legacy Gateway |
| Feature flag on | Surface filters blocks correctly; не предполагается смена command transport |
| Legacy Redux Snapshot | Локальные availableActions соответствуют state mapping |
| Server Order Snapshot | Snapshot/action list корректно отображаются, но не маскируют отсутствие command handler |
| Каждая видимая кнопка | Реальный onClick → конкретный handler → backend response → UI success/failure |
| AcceptOffer / ConfirmBoarding / CreateIncident | Либо реальный обработчик и серверный контракт, либо кнопка не должна рекламироваться как доступная функция |
| Rating | Реальный payload, сохранение только поддержанных полей, понятная ошибка при отказе |

## 8. Исправление статуса этапа 12

API-12-01 остаётся архитектурным несоответствием между объявленным Action Contract и legacy handler coverage. Но риск зависшего Passenger dispatch не подтверждён call-site evidence: найденный PassengerSurface использует actions для UI visibility; отправки пяти неподдержанных типов из Passenger UI не найдено.

Это уточнение не снимает необходимость полного button-to-backend аудита и не доказывает работоспособность соответствующих функций через другие chat/map/incident subsystems.
