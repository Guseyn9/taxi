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

Используемые серверные маршруты:

```text
GET /api/realtime/snapshot/taxi/order/{orderId}
WS  /api/realtime/ws/taxi/order/{orderId}
```

Серверный снапшот сохраняется в `state.domainOrder`; `availableActions` передаются
в Runtime без локального вычисления. Текущий order snapshot не подменяет
`state.driver`, потому что не содержит полного агрегата водителя. До появления
Driver Snapshot API Driver Surface продолжает использовать legacy projection.

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
ответ не может затереть realtime-обновление.

## Маршрутизация действий

Map Channel отправляет Action в `PlatformInterfaceRuntime`. Runtime передаёт его
существующей Application-стороне Interaction Contract и после завершения
запрашивает свежий Snapshot.

Runtime не запрещает Action на основании локального `availableActions`: это
представление для UI, а окончательная проверка остаётся в серверном Domain FSM.

## Временные адаптеры

- данные Driver HUD/List/Map уже читаются из PI Snapshot projection; временный
  `LegacyReduxSnapshotProvider` наполняет этот Snapshot из существующего Redux;
- Query и Realtime одного известного заказа подключаются через
  `FsmOrderSnapshotTransport`; полный Driver Snapshot пока отсутствует;
- Passenger-команды из UI уже идут через `LegacyPassengerGateway`, но внутри он
  временно вызывает старый API до появления серверного Command API;
- Driver lifecycle-команды идут через Action/Event gateway, а фактический вызов
  старого API изолирован в `LegacyBackendGateway`;
- `wayGraph` и часть Redux refresh/modal effects остаются migration bridge:
  бизнес-переход они не выполняют и удаляются после подключения серверного
  Snapshot/realtime.

Таким образом, транспорт чтения и realtime можно проверять до готовности остальных
серверных контрактов. Полная интеграция Driver Channel остаётся заблокирована
Command API и полным Driver Snapshot. Текущий статус Navigation, Passenger и
остальных Surface описан в `PLATFORM_INTERFACE_STAGE3_6_REPORT.md`.
