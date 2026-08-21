# TASK-PI-001: Query и Realtime

**Статус:** В работе — Query/Realtime и Command transport подключены; утверждённый Command Completion ещё не реализован сервером
**Дата:** 2026-08-16

## Что реализовано

- первичная загрузка snapshot одного известного taxi/order через Query API;
- передача серверного `availableActions` в Platform Interface Runtime;
- получение начального snapshot и `entity.updated` через WebSocket;
- игнорирование heartbeat `ping`;
- reconnect с экспоненциальной задержкой;
- восстановление актуального состояния из snapshot после reconnect;
- остановка WebSocket и таймеров при завершении Runtime;
- нормализация HTTP-ошибок на границе Backend Adapter;
- автоматическое переключение между серверным и legacy Provider.
- загрузка агрегата водителя через `GET /api/realtime/snapshot/taxi/driver/{userId}`;
- отправка lifecycle intents через `POST /api/commands/taxi/order/{orderId}`;
- `schemaVersion`, `commandId`, `correlationId` и `Idempotency-Key` для каждой команды;
- отдельное событие `driver.order.command.accepted`: ответ `202` не публикует
  ложное событие завершённого FSM-перехода;
- единая Promise-семантика lifecycle gateway: до появления нормативного Command
  Completion контракт Promise завершается только после наблюдения ожидаемого
  FSM-состояния в Snapshot; это временная integration-семантика и не является
  доказательством выполнения конкретного `instanceId`;
- runtime-проверка `202 new / 200 duplicate` и обязательных полей Command response;
- уже достигнутое целевое состояние не подтверждает lifecycle-команду даже при
  `duplicate=true`: текущий duplicate означает повторную выдачу Accepted response,
  а не успешное завершение worker;
- временная completion-логика изолирована в `DriverCommandCompletionWaiter`,
  который сохраняет `instanceId` и возвращает внутренний результат
  `COMPLETED/FAILED/TIMEOUT` без изменения публичного PI-контракта;
- временный recovery polling Driver Snapshot, пока события заказа не проецируются
  в realtime-канал водителя.
- защита от перезаписи свежего WS Snapshot устаревшим polling-ответом по серверным
  `revision`/`updatedAt`, порядку Query и WS epoch.
- compatibility mapping не подставляет вымышленные дату, пассажира, класс машины,
  валюту и другие отсутствующие доменные значения; серверный `driver.user`
  сохраняется в PI projection.

Весь доступ выполняется через `FsmOrderSnapshotTransport` и
`DomainApiSnapshotProvider`. Platform Channel не обращается к этим endpoint
напрямую.

## Настройка

Минимальная конфигурация:

```dotenv
REACT_APP_FSM_API_URL=https://fsm.example.test
REACT_APP_FSM_ORDER_ID=42
```

Дополнительные параметры:

```dotenv
REACT_APP_FSM_API_TOKEN=test-token
REACT_APP_FSM_WS_URL=wss://fsm.example.test
REACT_APP_FSM_WS_TOKEN_QUERY_PARAM=access_token
REACT_APP_FSM_DRIVER_USER_ID=205
REACT_APP_FSM_DRIVER_POLL_MS=5000
```

Последний параметр используется только при наличии gateway, который официально
принимает токен в query string. Текущая серверная реализация такого механизма не
содержит. Токен в React environment является публичным для пользователя сборки и
не подходит для production-секрета.

## Что пока не закрыто

Command API и Driver Snapshot больше не являются отсутствующими контрактами, но
TASK-PI-001 пока нельзя принять полностью:

1. Driver Snapshot содержит только `orderId/coreOrderId/state/mode/bState`,
   описание, цену и действия. Для реальной карты и полной карточки заказа нужны
   адреса, координаты, время, данные пассажира, назначенного водителя и автомобиля,
   а также монотонный `revision` или надёжный `updatedAt`.
2. События `taxi/order/{orderId}` не проецируются в `taxi/driver/{userId}`.
   Временно frontend повторяет Query каждые пять секунд.
3. Текущий серверный WebSocket принимает Bearer только в HTTP-заголовке, который
   браузерный `WebSocket` установить не может. Query token сервер не читает.
4. Для живого интеграционного прогона нужны URL, CORS, API key, БД и запущенный
   worker, чтобы проверить путь `202 Accepted -> transition -> updated Snapshot`.

## Локальная проверка

- 28 test suites, 133 tests — пройдены, включая сквозной тест
  Query/Realtime → Backend Adapter → Platform Runtime → Surface cleanup;
- TypeScript `--noEmit` — пройден;
- lint новых Platform Interface и Backend Adapter файлов — пройден;
- production build — собран;
- исходные `interaction-contract` и `map-channel` не изменены.

Живой серверный прогон не выполнялся: для него нужны адрес тестового FSM API,
совместимая браузерная авторизация, API key и тестовый водитель с заказами.


## Архитектурное ограничение: Command Completion

Текущий `POST /api/commands/taxi/order/{orderId}` подтверждает приём/enqueue команды,
но не предоставляет нормативного подтверждения завершения конкретного asynchronous
`instanceId`.

Поэтому текущая реализация не должна интерпретироваться как окончательно решённая
семантика Command Completion.

### Текущее поведение frontend

После `202 Accepted` frontend получает `instanceId` и может ожидать наблюдаемое
изменение Snapshot.

При этом:

- `202 Accepted` не считается `COMPLETED`;
- `200 duplicate` не считается `COMPLETED`;
- уже существующее target state не считается доказательством выполнения команды;
- Snapshot используется только как временный механизм наблюдения состояния;
- конкретный `instanceId` не считается достоверно завершённым без нормативного
  серверного completion-контракта.

Таким образом, текущий lifecycle gateway обеспечивает практическое ожидание
изменения состояния, но не утверждает причинную связь:

```text
instanceId → конкретный FSM transition → COMPLETED
```

### Принятое архитектурное решение

Нормативным механизмом Command Completion для asynchronous Command API принят
Command Status API:

```http
GET /api/commands/{instanceId}
```

Статусы `PENDING`, `PROCESSING`, `COMPLETED` и `FAILED` относятся к конкретному
execution. Realtime completion event может использоваться как ускоритель, но не
как нормативный источник результата.

До серверной реализации Command Status API временное наблюдение Snapshot не
должно становиться частью публичного completion-контракта Platform Interface.

См. [AQ-PLATFORM-002](migration/AQ_PLATFORM_002.md) и
[TASK-CORE-001](TASK_CORE_001_COMMAND_COMPLETION.md).

### Граница ответственности

Данный вопрос не решается самостоятельно внутри Passenger/Driver Channel или
локальной FSM Platform Interface.

Platform Interface должен потреблять утверждённый контракт Platform Core, а не
выводить completion команды из наблюдаемого target state.

## Что можно продолжать до реализации Command Status API

Не блокируются:

- Query transport;
- Driver Snapshot transport;
- Realtime transport;
- reconnect;
- recovery polling;
- Backend Adapter;
- маппинг Action/Command;
- маппинг Snapshot;
- Runtime integration;
- интеграционные тесты транспорта и Runtime;
- рефакторинг Channel на публичный API Platform Interface.

Блокируется только окончательное подтверждение конкретного asynchronous
`instanceId` как `COMPLETED/FAILED`.

## Условия полного закрытия TASK-PI-001

TASK-PI-001 можно принять после выполнения двух групп условий.

### A. Техническая готовность frontend

- Query работает через Platform Interface;
- Realtime работает через Platform Interface;
- reconnect и recovery работают;
- Command transport работает через Backend Adapter;
- Channel не обращается к серверным endpoint напрямую;
- локальные тесты и build проходят.

### B. Серверная интеграционная готовность

- Driver Snapshot содержит данные, необходимые подключённому Channel;
- Realtime предоставляет необходимую проекцию событий либо утверждённый fallback;
- браузерная схема WebSocket authorization поддержана сервером;
- доступна тестовая среда;
- существует нормативный Command Completion contract;
- проведён живой сквозной прогон Command:
  `Action → Command API → enqueue → worker → FSM → completion → updated Snapshot/event`.

До выполнения группы B задача имеет статус **готова со стороны frontend, но не
закрыта по интеграционному контракту**.
