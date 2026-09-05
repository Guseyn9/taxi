# Platform Interface Runtime

**Статус:** реализован базовый Runtime и граница Domain FSM Snapshot  
**Дата:** 2026-08-08

## Назначение

Runtime связывает Platform Interface с серверным Domain FSM и управляет жизненным
циклом Surface. Он не знает HTTP-адресов, Redux, Taxi-состояний и бизнес-правил.

```text
Domain FSM API / realtime
        -> SnapshotProvider
        -> PlatformInterfaceRuntime
        -> Surface
        -> Platform Channel
```

## Единый Snapshot

`PlatformSnapshot` содержит:

- `revision` — версию серверного состояния;
- `state` — read-only доменное представление;
- `availableActions` — разрешённые сервером действия;
- `updatedAt` — время формирования серверного состояния.

Snapshot копируется и замораживается на границе Provider. Это защита от
случайной записи в PI/Surface, а не sandbox для вложенных доменных объектов.
Runtime не вычисляет `availableActions` самостоятельно и не дублирует
бизнес-правила FSM.

## Provider

`PlatformSnapshotProvider` не зависит от технологии транспорта и требует только
операцию `load()`. Для realtime Provider может дополнительно реализовать
`subscribe()`.

`DomainApiSnapshotProvider` адаптирует внедрённый приложением транспорт:

- `loadSnapshot()` — HTTP/query-загрузка снапшота;
- `subscribeSnapshots()` — необязательный WebSocket/SSE/realtime поток.

Composition root использует `SwitchableSnapshotProvider`. Если сервер не настроен,
приложение подключает `LegacyReduxSnapshotProvider`. Это migration bridge, который
позволяет использовать Runtime и Surface без серверного Driver Snapshot.

Для существующего серверного API реализован `FsmOrderSnapshotTransport`. Он
загружает один известный taxi/order через Query API и подписывается на его
изменения через WebSocket. При наличии обязательных переменных окружения
`App.tsx` выбирает этот Provider автоматически:

| Переменная | Назначение |
|---|---|
| `REACT_APP_FSM_API_URL` | Базовый HTTP URL FSM API |
| `REACT_APP_FSM_ORDER_ID` | Идентификатор тестируемого заказа |
| `REACT_APP_FSM_API_TOKEN` | Необязательный Bearer token для Query API |
| `REACT_APP_FSM_WS_URL` | Необязательный отдельный `ws://` или `wss://` URL |
| `REACT_APP_FSM_WS_TOKEN_QUERY_PARAM` | Имя query-параметра токена, только если его поддерживает gateway |
| `REACT_APP_FSM_DRIVER_USER_ID` | Необязательная подмена id авторизованного водителя для теста |
| `REACT_APP_FSM_DRIVER_POLL_MS` | Recovery polling Driver Snapshot, по умолчанию 5000 мс; 0 отключает polling |
| `REACT_APP_FSM_COMMAND_STATUS_ENABLED` | `true` включает Command Status после его развёртывания |
| `REACT_APP_FSM_COMMAND_STATUS_POLL_MS` | Интервал polling `GET /api/commands/{instanceId}`, по умолчанию 1000 мс |

Используемые серверные маршруты:

```text
GET /api/realtime/snapshot/taxi/order/{orderId}
WS  /api/realtime/ws/taxi/order/{orderId}
GET /api/realtime/snapshot/taxi/driver/{userId}
WS  /api/realtime/ws/taxi/driver/{userId}
POST /api/commands/taxi/order/{orderId}
GET /api/commands/{instanceId}
```

Серверный order snapshot сохраняется в `state.domainOrder`; `availableActions` передаются
в Runtime без локального вычисления. Текущий order snapshot не подменяет
`state.driver`, потому что не содержит полного агрегата водителя. Driver Surface
использует отдельный агрегированный Driver Snapshot либо legacy projection при
отсутствующей серверной конфигурации.

`FsmDriverSnapshotTransport` сохраняет исходный агрегат в `state.domainDriver` и
строит совместимую `state.driver` projection для существующих Driver Surface.
`FsmTaxiCommandTransport` отправляет UI intent, а не имя FSM action. При наличии
`REACT_APP_FSM_API_URL` lifecycle-обработчик `DriverMapGateway` использует Command
API; без конфигурации сохраняется legacy fallback.

Наличие общего `REACT_APP_FSM_API_URL` не означает, что Command Status уже
развёрнут. Нормативный status waiter включается только при
`REACT_APP_FSM_COMMAND_STATUS_ENABLED=true`; до этого продолжает работать
Snapshot-based completion.

Ответ `202 Accepted` публикуется как `driver.order.command.accepted` и означает
только постановку trigger/instance в очередь. Он не порождает `arrived`, `started`,
`boarding_confirmed` или `finished`: выполнение перехода подтверждается изменением
Driver Snapshot после обработки команды worker-ом. Promise публичных методов
`arrive/start/confirmBoarding/finish` остаётся незавершённым до появления целевого
состояния заказа в Query/Realtime Snapshot, поэтому имеет одинаковую completion-
семантику в FSM и legacy режимах.

Временная completion-логика изолирована от `DriverMapGateway` внутренним
`DriverCommandCompletionWaiter`. Gateway передаёт ему `instanceId`, полученный в
`CommandAccepted`, и обрабатывает единый результат `COMPLETED/FAILED/TIMEOUT`.
При включённом Command Status waiter опрашивает execution по `instanceId`.
Серверный `FAILED` помечается как execution failure, а HTTP/protocol error — как
status lookup failure; это не меняет публичный PI API или UI. Snapshot-based
waiter остаётся временным rollout fallback.

Оба результата отклоняют lifecycle Promise, поскольку успешное выполнение не
подтверждено. При этом `failureKind=EXECUTION` утверждает, что FSM завершил
команду ошибкой, а `failureKind=STATUS_LOOKUP` означает только невозможность
получить completion. Gateway сохраняет этот признак в `BackendInteractionError`
и `driver.order.action.failed`; success event для lookup failure не публикуется.

Command adapter принимает только `202` для новой команды и `200` для duplicate,
а также проверяет обязательные поля Accepted response. Некорректный успешный HTTP
ответ преобразуется в `FSM_COMMAND_PROTOCOL_ERROR` на adapter boundary.

Если целевое состояние было достигнуто ещё до отправки команды, оно не завершает
ожидание ни для `202`, ни для `200 duplicate`. Текущий серверный idempotency
contract подтверждает только прежнюю постановку instance в очередь и сохраняет
ответ со статусом `PENDING`, но не результат worker. Поэтому старое состояние не
доказывает успешность конкретной команды; без нового наблюдаемого перехода
ожидание завершится контролируемым timeout.

Compatibility projection не генерирует отсутствующие доменные значения. Если
Driver Snapshot не прислал время, пассажира, класс автомобиля, валюту или другие
поля, они остаются отсутствующими до расширения серверного контракта. Поле
`driver.user` сохраняется; `userId` механически нормализуется в legacy `u_id` и
объединяется с bootstrap-профилем канала.

`REACT_APP_FSM_API_TOKEN` попадает в браузерную сборку и допустим только для
тестового окружения. Native WebSocket браузера не умеет отправлять произвольный
заголовок `Authorization`. Поэтому production-подключение требует согласованной
сервером схемы: cookie/same-origin principal, авторизующий reverse proxy либо
официально поддерживаемый query token. Текущий серверный API query token не читает.

## Lifecycle

Runtime имеет состояния:

- `idle`;
- `loading`;
- `ready`;
- `error`;
- `stopped`.

Первый mounted Surface запускает Runtime и загрузку Snapshot. Последний unmount
останавливает realtime-подписку. При ошибке сохраняется последний успешный
Snapshot, а ошибка публикуется через состояние Runtime. React получает состояние
через `usePlatformRuntime()`.

Push-снапшот считается новее уже выполняющегося query-запроса: поздний старый
ответ не может затереть realtime-обновление. Driver adapter также отбрасывает
уменьшившиеся серверные `revision`/`updatedAt` и ответы более ранних параллельных
Query. До добавления версии в Driver Snapshot порядок unversioned Query можно
гарантировать только относительно момента получения WS-сообщения.

## Маршрутизация действий

Map Channel отправляет Action в `PlatformInterfaceRuntime`. Runtime передаёт его
существующей Application-стороне Interaction Contract и после завершения
запрашивает свежий Snapshot.

Runtime не запрещает Action на основании локального `availableActions`: это
представление для UI, а окончательная проверка остаётся в серверном Domain FSM.

## Временные адаптеры

- данные Driver HUD/List/Map уже читаются из PI Snapshot projection; временный
  `LegacyReduxSnapshotProvider` наполняет этот Snapshot из существующего Redux;
- Query/Realtime одного заказа подключаются через `FsmOrderSnapshotTransport`,
  Driver aggregate через `FsmDriverSnapshotTransport`;
- Passenger-команды из UI идут как Interaction Actions через PI Runtime и
  `LegacyPassengerGateway`; его обработчик временно вызывает старый API и
  возвращает коррелированные success/failure Events до появления серверного
  Command API;
- основные Passenger-компоненты не зависят от Redux напрямую: временная связь
  изолирована в `LegacyPassengerChannelStoreAdapter`;
- Driver lifecycle-команды идут через Action/Event gateway и
  `FsmTaxiCommandTransport`; `LegacyBackendGateway` остаётся fallback без FSM URL;
- `wayGraph` и часть Redux refresh/modal effects остаются migration bridge:
  бизнес-переход они не выполняют и удаляются после подключения серверного
  Snapshot/realtime.

Полная интеграция Driver Channel теперь ограничена не отсутствием endpoint, а
неполнотой карточки Driver Snapshot, отсутствием order -> driver realtime
проекции и браузерной WS-авторизацией. Текущий статус Navigation, Passenger и
остальных Surface описан в `PLATFORM_INTERFACE_STAGE3_6_REPORT.md`.
