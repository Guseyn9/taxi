# Taxi FSM backend handoff

Дата среза: 2026-08-13.

Это серверный пакет текущей реализации FSM Platform и Taxi Domain для
согласования и разработки Command API и Driver Snapshot. Это не фронтовый архив
и не конфигурация iBronevik.

## Что уже реализовано

- общий табличный FSM Runtime поверх MySQL;
- `ProcessDef`, Registry, guards, effects и SQL Core с `expected_state`;
- worker с отдельной транзакцией на каждый FSM instance;
- outbox, timers и realtime infrastructure;
- Taxi Order FSM для DIRECT, VOTE и OFFER;
- ORM/repository и action layer Taxi Domain;
- role-aware snapshot отдельного заказа;
- HTTP Query API, replay событий и WebSocket для отдельного заказа;
- HTTP Command API (`intent` → `enqueue_fsm_instance` + idempotency envelope);
- агрегированный Driver Snapshot (`GET /api/realtime/snapshot/taxi/driver/{userId}`);
- тесты конкурентных переходов, worker recovery, outbox, snapshot и realtime.

## Текущие серверные маршруты

```text
GET  /health
POST /api/commands/{service}/{entity_type}/{entity_id}
GET  /api/commands/{instanceId}  # Command Completion
GET  /api/realtime/snapshot/{service}/{entity_type}/{entity_id}
GET  /api/realtime/events/{service}/{entity_type}/{entity_id}
WS   /api/realtime/ws/{service}/{entity_type}/{entity_id}
```

### Command Completion

GET /api/commands/{instanceId} позволяет получить текущий статус выполнения команды по её instanceId.

**Контракт:**

* `instanceId` — **integer** (BIGINT в БД, `server_fsm_instances.id`), уникальный внутри `fsm_command_idempotency` (constraint `uq_fsm_command_idempotency_instance`).
* Допустимые статусы: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`. Любой другой статус запрещён на уровне helper-функции `update_command_status`.
* `COMPLETED` и `FAILED` — терминальные. После перехода в терминальный статус он не может быть изменён на другой (защита в `fsm_core.command_idempotency.update_command_status` через `WHERE status NOT IN ('COMPLETED', 'FAILED')`).

**Ответ:**

```json
{
  "instanceId": 123,
  "status": "PENDING",
  "commandId": "cmd-100",
  "correlationId": "corr-100",
  "causationId": "cause-1",
  "idempotencyKey": "taxi:order:42:driver_arrived:cmd-100",
  "service": "taxi",
  "entityType": "order",
  "entityId": 42,
  "intent": "driver_arrived",
  "duplicate": false
}
```

Для `status = "FAILED"` ответ дополнительно содержит машинный `errorCode` и (опционально) текстовое `errorMessage`:

```json
{
  "instanceId": 123,
  "status": "FAILED",
  "errorCode": "INVALID_TRANSITION",
  "errorMessage": "order_in_ride + order_finish is not allowed",
  "...": "..."
}
```

`errorMessage` носит информационный характер и не должен использоваться как машинный идентификатор ошибки.

**Машинные коды ошибок** (`fsm_core/error_codes.py`):

| errorCode | Когда возвращается |
|---|---|
| `INVALID_TRANSITION` | FSM отверг переход: несоответствие `expected_state`, неизвестное действие/состояние, guard отклонил переход, effect упал, `TRANSITION_CONFLICT` |
| `UNKNOWN_ENTITY` | Неизвестный `entity_type` в SQL Core, `ProcessEntityMismatch`, невалидное `entity_binding` |
| `INVALID_PARAMETERS` | Ошибка валидации envelope, неизвестный intent, некорректный payload |
| `AUTHORIZATION_FAILED` | Отказ в авторизации Principal |
| `INTERNAL_ERROR` | Любая другая ошибка; fallback |

**Семантика статусов:**

* `PENDING`: команда принята сервером и зарегистрирована, но выполнение ещё не началось.
* `PROCESSING`: команда передана worker'у и находится в процессе выполнения.
* `COMPLETED`: конкретный instanceId успешно завершил требуемую command semantics / FSM transition.
* `FAILED`: конкретный instanceId завершился с ошибкой. Ответ содержит машинный `errorCode`.

**Отложенное завершение (deferred completion).** Если переход должен
подтвердиться внешней системой (Core), effect вызывает
`defer_current_command_completion()` и пишет в `core_outbox` событие с
`completion_json`. Worker фиксирует переход и закрывает свою строку
`server_fsm_instances` как `COMPLETED`, но публичная команда остаётся
`PROCESSING`. После окончательной доставки dispatcher в той же транзакции,
что и статус outbox, ставит в очередь follow-up trigger:

* `SENT` → `onSentTrigger` с `metadata.completesCommand` → после его перехода команда `COMPLETED`;
* окончательный `FAILED` (в том числе после истёкшего lease) → `onFailedTrigger` с `metadata.failsCommand` → после компенсирующего перехода команда `FAILED` с ошибкой доставки;
* если сам follow-up переход упал → команда `FAILED`, сообщение называет оба шага.

`RETRY` команду не меняет. Требуется миграция `fsm_core/sql/008_outbox_command_completion.sql`.
Пока `outbox_worker.py` не запущен, отложенная команда остаётся `PROCESSING`.

`202 Accepted` от POST и `200 duplicate` от повторного POST **не являются** COMPLETED. Для определения результата используйте `GET /api/commands/{instanceId}`.

**Duplicate POST возвращает актуальный статус.** Ответ на повторный POST с тем же `Idempotency-Key` содержит не исходный `PENDING` из момента первого приёма, а *текущий* статус execution (поднимается из колонки `status` таблицы `fsm_command_idempotency` через `get_command_by_instance_id`). Для `FAILED` в duplicate-ответе также поднимаются `errorCode` и `errorMessage`. Это позволяет клиенту получить результат без отдельного GET, но GET остаётся нормативным механизмом для надёжного polling после reconnect.

**HTTP-ответы:**

| Сценарий | Код | Тело |
|---|---|---|
| Команда найдена | 200 | `{instanceId, status, ...}` |
| Неизвестный `instanceId` | 404 | `{"detail": "Command with instanceId ... not found"}` |
| Нет аутентификации | 401 | `{"detail": "Bearer token is required"}` |
| Principal не имеет доступа | 403 | `{"detail": "Principal ... is not authorized to read command execution"}` |

**Авторизация GET.** Principal должен быть `admin`/`system`, исходным инициатором команды (`requestedByUserId`), либо пройти `snapshot_service.authorize(service, entity_type, entity_id)` по сохранённым в `response_json` данным. Это исключает утечку чужих executions (см. `CommandService._authorize_status_read`).

**Архитектурное разделение источников истины.** В платформе есть два источника статуса выполнения команды, и они играют разные роли:

| Таблица | Роль | Кто пишет | Immutability |
|---|---|---|---|
| `fsm_command_idempotency.status` | **Авторитетный публичный outcome** — то, что возвращает `GET /api/commands/{instanceId}` | `CommandService.accept` (PENDING), worker (PROCESSING/COMPLETED/FAILED), `recover_stale` | Terminal immutability: после `COMPLETED`/`FAILED` статус не меняется |
| `server_fsm_instances.instance_status` | **Внутреннее worker execution state** — tracking какой worker забрал задачу и на каком шаге находится | worker (`process_next`), `recover_stale` | Может меняться (PROCESSING → FAILED при crash recovery) |

**Принцип:** `fsm_command_idempotency.status` — это публичный бизнес-outcome команды, который видит клиент. `server_fsm_instances.instance_status` — техническое состояние worker-задачи. Если между ними возникает конфликт (например, `server_fsm_instances=FAILED` после crash recovery, но `fsm_command_idempotency=COMPLETED`), Command Completion API возвращает авторитетный terminal-статус из `fsm_command_idempotency`. Это сознательное архитектурное решение: terminal immutability публичного outcome важнее синхронизации с внутренним execution state.

**Recovery sync (atomic).** `FsmInstanceWorker.recover_stale` в одной транзакции обновляет обе таблицы. Если любая операция mirror в `fsm_command_idempotency` завершается ошибкой (например, `CommandStatusError` при изменении графа переходов), вся recovery-транзакция откатывается — обе таблицы остаются в исходном состоянии, stale instances остаются в `PROCESSING` для следующего recovery cycle. Это **atomicity contract**: частичное восстановление, рассинхронизирующее таблицы, хуже, чем откат с повторной попыткой.

* **Non-terminal команды** (`PENDING` / `PROCESSING`): статус `fsm_command_idempotency` синхронизируется с восстановленным статусом `server_fsm_instances` (`PENDING` для повторной попытки, `FAILED` при исчерпании retry-лимита). После recovery для non-terminal команд таблицы не расходятся.
* **Terminal команды** (`COMPLETED` / `FAILED`): helper `update_command_status` намеренно отказывается перезаписывать terminal-статус (контракт TASK-CORE-001 §9). В этом случае возможна ситуация, когда `server_fsm_instances` перешёл из `PROCESSING` в `FAILED` (worker упал mid-flight и исчерпал retry-лимит), а `fsm_command_idempotency` осталась `COMPLETED`. Command Completion API вернёт terminal `COMPLETED` — авторитетный ответ для клиента.

Recovery также обновляет только те `instance_id`, которые были захвачены на Step 1 (SELECT `FOR UPDATE SKIP LOCKED`) — Step 2 использует `WHERE id IN (:ids)`, а не широкий `WHERE instance_status='PROCESSING'`. Это закрывает race window: новый stale execution, появившийся между Step 1 и Step 2, не будет обновлён в `server_fsm_instances` без последующего mirror в `fsm_command_idempotency`.

**Retention.** Хранение записи определяется переменной окружения `FSM_COMMAND_IDEMPOTENCY_TTL_HOURS` (по умолчанию 24 часа, минимальное рекомендуемое значение для production — 24 часа).

Граница ответственности:

* **Retention enforcement** (в рамках TASK-CORE-001): колонка `expires_at` + фильтр `expires_at > UTC_TIMESTAMP()` в `get_command_by_instance_id` и `get_command_idempotency`. Запрос статуса после истечения retention возвращает 404.
* **Physical cleanup** (вне TASK-CORE-001): удаление просроченных строк из `fsm_command_idempotency` выполняется отдельной эксплуатационной job-очисткой (не входит в этот PR). Само наличие просроченных, но неудалённых строк не влияет на корректность GET — они просто невидимы.

**Status state machine (runtime enforcement).** Допустимые переходы статусов формализованы в `fsm_core.command_idempotency.ALLOWED_TRANSITIONS` — и **применяются в runtime**, а не только декларативно. Helper `update_command_status` читает текущий статус, вызывает `is_allowed_transition(current, target)`, и:

- разрешает переход, если он есть в графе (или это idempotent re-write того же статуса);
- возвращает `False` для попыток выйти из terminal state (COMPLETED/FAILED → что-либо) — soft no-op, чтобы worker мог обработать concurrent terminal transition без exception;
- поднимает `CommandStatusError` для любых других запрещённых переходов (например, если кто-то добавит новый статус в `ALLOWED_STATUSES`, но забудет добавить transition — helper громко сообщит об ошибке, а не промолчит).

```text
PENDING  ──►  PROCESSING  ──►  COMPLETED
   │              │
   │              ├──►  FAILED
   │              │
   │              └──►  PENDING  (recovery: retry after crash)
   │
   ├──►  COMPLETED  (operational shortcut: worker resolves without PROCESSING)
   │
   └──►  FAILED     (operational shortcut: worker resolves without PROCESSING)
```

Не показаны на графе: **idempotent rewrites** (same status → same status) — `PENDING → PENDING`, `PROCESSING → PROCESSING`, `COMPLETED → COMPLETED`, `FAILED → FAILED`. Эти переходы разрешены `is_allowed_transition` (возвращает `True` для `from_status == to_status`) и используются recovery (повторная установка PENDING) и worker'ом (повторная установка PROCESSING при retry). Terminal idempotent rewrites (`COMPLETED → COMPLETED`, `FAILED → FAILED`) возвращают `False` — conditional UPDATE не матчит строку (status уже terminal), но это не ошибка.

Terminal states (`COMPLETED`, `FAILED`) не имеют исходящих рёбер — immutability гарантируется на двух уровнях:

1. **Python state-machine check** — `is_allowed_transition` проверяет граф переходов; для terminal states все исходящие рёбра запрещены, и helper возвращает `False` (soft no-op) вместо exception, чтобы worker мог обработать concurrent terminal transition.
2. **SQL conditional UPDATE** — `WHERE status NOT IN ('COMPLETED', 'FAILED')` в `UPDATE` запросе является race-safe guard: если другая транзакция перевела строку в terminal state между Python-check и SQL-выполнением, `rowcount` будет 0, и helper вернёт `False`.

Initial write (`put_command_idempotency`) также проходит через `is_allowed_transition(None, status)` — только `PENDING` разрешён как начальный статус. Это предотвращает создание записи, которая сразу находится в terminal state, что позволило бы обойти весь lifecycle.

**Transaction boundary contract для `CommandService.accept()`.** Метод выполняет две записи в одной транзакции вызывающего: `enqueue_fsm_instance` (server_fsm_instances) + `put_command_idempotency` (fsm_command_idempotency). При concurrent duplicate оба запроса создают worker instance, но только один выигрывает `INSERT IGNORE` на idempotency table. Orphan instance loser'а безопасен **только** если caller откатывает транзакцию в duplicate path (как делает HTTP adapter: `if result.duplicate: session.rollback()`). **Архитектурное ограничение:** callers не должны commit'ить между enqueue и idempotency claim — это приведёт к утечке orphan rows, которые worker попытается выполнить как второе execution для того, что клиент видит как одну команду. См. docstring `CommandService` для деталей.

**Идемпотентность миграции.** Колонка `status` и индекс `idx_fsm_command_idempotency_status` включены в `fsm_core/sql/006_command_api.sql` с защитой через `INFORMATION_SCHEMA` — повторный запуск миграции не падает с `Duplicate column`/`Duplicate key`. Файл `007_add_status_to_command_idempotency.sql` оставлен пустым (одноразовая миграция влита в 006).

**Precondition для UNIQUE(instance_id).** Миграция 006 добавляет `CREATE UNIQUE INDEX uq_fsm_command_idempotency_instance` на колонку `instance_id`. Перед применением на существующей БД необходимо убедиться, что дубликатов нет:

```sql
SELECT instance_id, COUNT(*)
FROM fsm_command_idempotency
WHERE instance_id IS NOT NULL
GROUP BY instance_id
HAVING COUNT(*) > 1;
```

Пустой результат → UNIQUE constraint добавится безопасно. Непустой результат → миграция упадёт с `Duplicate entry` (это ожидаемо: дубликаты нужно устранить вручную перед применением миграции). Для чистой установки precondition не требуется — `instance_id` всегда уникален по построению (`server_fsm_instances.id` через `LAST_INSERT_ID()`).

Для Taxi используются `service=taxi`, `entity_type=order` или `entity_type=driver`.

### Command API

```text
POST /api/commands/taxi/order/{orderId}
Authorization: Bearer <token>
Idempotency-Key: <optional if body.idempotencyKey or body.commandId is set>
```

Тело:

```json
{
  "schemaVersion": "1.0",
  "commandId": "cmd-100",
  "correlationId": "corr-100",
  "causationId": "cause-1",
  "idempotencyKey": "taxi:order:42:driver_arrived:cmd-100",
  "intent": "driver_arrived",
  "payload": {}
}
```

Поведение:

- клиент передаёт внешний `intent` из таблицы ниже (или frontend alias), а не
  имя FSM action;
- API проверяет Principal, entity access policy и роль intent;
- создаёт отдельный `server_fsm_instances` через `enqueue_fsm_instance` и
  передаёт работу worker;
- идемпотентность хранится в `fsm_command_idempotency` (миграция
  `fsm_core/sql/006_command_api.sql`); повтор с тем же ключом возвращает
  сохранённый `instanceId` с `duplicate=true`.

### Driver Snapshot

```text
GET /api/realtime/snapshot/taxi/driver/{userId}
Authorization: Bearer <token>
```

Ответ:

```json
{
  "driverUserId": 205,
  "driver": {
    "user": {"userId": 205},
    "readyOrders": [],
    "activeOrders": [],
    "historyOrders": [],
    "currentTrip": null
  },
  "availableActions": ["driver.order.arrive"]
}
```

Водитель видит только свои candidate/offer и назначенные себе заказы.
`availableActions` на агрегате берутся из `currentTrip`. Snapshot отдельного
заказа для роли driver по-прежнему не отдаёт passenger-кнопки.

## Что требуется реализовать

1. ~~Command API для команд Driver/Passenger~~ — реализован
   (`POST /api/commands/...` → trigger/instance → worker).
2. ~~Агрегированный Driver Snapshot~~ — реализован
   (`GET /api/realtime/snapshot/taxi/driver/{userId}`).
3. Реальный HTTP-адаптер `CoreAdapter` для iBronevik. Сейчас в
   `domains/taxi/core_adapter.py` зафиксирован контракт, но production-реализации
   нет.
4. Браузерно-совместимая WebSocket-аутентификация. Native WebSocket не умеет
   передавать произвольный заголовок `Authorization`.

## Маппинг команд Taxi Domain

| Внешнее намерение | Trigger | FSM action |
|---|---|---|
| Опубликовать VOTE | `vote_requested` | `order_publish_vote` |
| Опубликовать OFFER | `offer_requested` | `order_publish_offer` |
| Назначить DIRECT | `direct_assignment_requested` | `order_assign_direct` |
| Отменить заказ (пассажир) | `cancel_requested` | `order_cancel_by_client` |
| Отменить взятый заказ (водитель) | `driver_cancel_requested` (`driver.order.cancel`) | `order_cancel_by_driver` |
| Выбрать кандидата | `candidate_selected` | `order_select_candidate` |
| Освободить кандидата | `candidate_released` | `order_release_candidate` |
| Выбрать оффер | `offer_selected` | `order_select_offer` |
| Водитель прибыл | `driver_arrived` | `order_arrive` |
| Начать поездку | `ride_started` | `order_start` |
| Завершить поездку | `ride_finished` | `order_finish` |
| Истёк поиск | `order_expired` | `order_expire` |
| No-show | `pickup_timeout` | `order_no_show` |
| Прервать поездку | `ride_interrupted` | `order_interrupt_ride` |

### Отмена взятого заказа водителем

* Команду принимает только назначенный водитель заказа (`performer_local_user_id`
  или `selected_candidate`/`selected_offer`/`driver_user_id` в metadata), а также
  `admin`/`system`. Остальные водители, включая бывших кандидатов, получают `403`
  до создания instance. Правило — `can_execute_taxi_order_command` в
  `domains/taxi/security.py`, зарегистрировано как command policy
  (`registry.register_command_policy`); `CommandService.accept` вызывает его после
  entity access policy.
* Guard `can_driver_cancel_order` разрешает только `order_vote_driver_assigned`,
  `order_driver_assigned`, `order_driver_arrived`.
* Переход ведёт в `order_driver_cancel_pending`; effect `request_core_driver_cancel`
  пишет `set_cancel_state` в `core_outbox` и откладывает завершение команды.
* Core подтвердил → `driver_cancel_confirmed` → `order_cancelled`, команда `COMPLETED`.
* Core окончательно не ответил → `driver_cancel_failed` → заказ возвращается в
  исходное состояние (`metadata.driver_cancel.previous_state`), команда `FAILED`.
* Отказ водителя от заказа во время поиска через Command API не выполняется.
* Учётные данные инициатора для iBronevik и FormData-обработчик outbox пока не
  реализованы: `core_http` отправляет JSON. До их появления живая отмена в Core
  через этот путь не работает.

После назначения водителя бывшие кандидаты и авторы офферов теряют доступ к
snapshot/realtime заказа (`domains/taxi/security.py`).

`driver.order.confirm_boarding` на фронте пока объединяет проверку посадочного
кода и запуск поездки. Отдельная FSM-команда для него не утверждена: boarding
остаётся guard/effect перед `order_start`.

## Где смотреть

- `domains/taxi/processes.py` - регистрация процессов и Trigger -> Action.
- `domains/taxi/intents.py` - внешние Command intents и frontend aliases.
- `domains/taxi/fsm_spec.py` - машинный граф состояний и переходов.
- `domains/taxi/actions.py` - legacy action facade и реальные доменные операции.
- `domains/taxi/repositories.py` - ORM/repository методы.
- `domains/taxi/query_api.py` - Order Snapshot и агрегированный Driver Snapshot.
- `domains/taxi/core_adapter.py` - контракт с iBronevik.
- `fsm_core/` - Runtime, worker, SQL Core, outbox, timers, realtime и Command API.
- `fsm_api.py` - Query/Command/Realtime composition root.
- `frontend-contract/` - фактические Action и Snapshot expectations фронта.
- `reference/driver-emulator/` - реальные вызовы API iBronevik без рабочих
  учётных данных.

## База данных

Для ознакомления приложен исходный полный taxi/VOTE dump и актуальные
идемпотентные миграции в `fsm_core/sql`, а также Taxi/Courier seed внутри
`domains/*/sql`.

Порядок для существующей БД описан в `fsm_core/README.md`. Для чистой установки:

1. применить доменную базовую схему;
2. применить `fsm_core/sql/install_fsm_platform.sql`;
3. применить `fsm_core/sql/003_fsm_platform.sql`;
4. применить `fsm_core/sql/004_scope_domain_transitions.sql`;
5. применить `fsm_core/sql/005_outbox_realtime.sql`;
6. применить `fsm_core/sql/006_command_api.sql`;
7. применить `fsm_core/sql/008_outbox_command_completion.sql`;
8. применить `domains/taxi/sql/taxi_order_fsm_seed.sql`.

## Транзакционная граница

HTTP Command adapter (`command_api.py`) открывает Session, коммитит постановку
instance и закрывает Session. `CommandService` и `enqueue_fsm_instance` только
пишут в переданную Session и не владеют транзакцией. Worker владеет Session на
исполнение FSM (`commit`/`rollback` перехода). Repository, guard, effect и
action не создают и не закрывают Session. Внешняя доставка outbox выполняется
после commit worker.

## Проверка среза

```text
python -m unittest discover -s tests -v
```

Для интеграционных тестов используется `tests/integration/docker-compose.yml`.

## Что намеренно не вложено

- рабочие логины, токены и `driver-emulator/config.json`;
- frontend целиком;
- старые архивы и промежуточные Stage-пакеты;
- production-конфигурация iBronevik.
