# Жизненный цикл FSM Platform

Документ описывает целевой путь команды от клиента до внешнего Core и обратно
в пользовательский интерфейс.

## Общая схема

```text
Клиент
  |
  | аутентифицированная доменная команда
  v
Domain API
  |
  | INSERT новой PENDING-задачи
  v
server_fsm_instances
  |
  | FOR UPDATE SKIP LOCKED
  v
FSM Worker
  |
  | одна Session и одна транзакция на задачу
  v
ProcessDef -> Context Builder -> Action Resolver
  |
  v
TransitionRepository -> Guard
  |
  v
fsm_perform_action_v2(expected_state)
  |
  | условный UPDATE + fsm_action_logs
  v
Post-transition Context -> Effect
  |
  +--> локальные доменные изменения
  +--> core_outbox
  +--> realtime_events
  |
  v
Worker COMMIT
  |
  +--> Outbox Dispatcher -> Core
  |
  +--> Realtime Publisher -> InMemory/Redis -> WebSocket
                                           |
                                           v
                                      новый Snapshot
```

## Приём команды

Внешний клиент передаёт доменную команду, а не имя SQL-действия FSM.
`ProcessDef` и доменный resolver преобразуют команду или системный trigger в
`fsm_action`.

Каждый trigger создаёт отдельную строку `server_fsm_instances`. Новая команда
не перезаписывает уже ожидающую или выполняемую команду того же заказа.

## Выполнение перехода

Worker является единственным владельцем `Session`, `COMMIT` и `ROLLBACK`.
На каждую задачу создаётся отдельная транзакция.

1. Context Builder читает и блокирует доменную сущность через
   `SELECT ... FOR UPDATE`.
2. Action Resolver выбирает действие.
3. Transition Repository находит декларативный переход.
4. Guard проверяет бизнес-условия на согласованном pre-transition context.
5. SQL Core выполняет условный `UPDATE ... WHERE status = expected_state`.
6. Если строка не обновлена, возвращается `TRANSITION_CONFLICT`.
7. После перехода Runtime заново строит context и проверяет новое состояние.
8. Effect получает post-transition context и пишет только локальные изменения,
   Outbox или таймеры.
9. Realtime-событие записывается в той же транзакции.
10. Worker фиксирует все изменения одним `COMMIT`.

При любой ошибке Worker выполняет `ROLLBACK`. Внешние HTTP-вызовы до `COMMIT`
не выполняются.

## Outbox

После фиксации доменной транзакции Outbox Dispatcher:

1. захватывает запись через `FOR UPDATE SKIP LOCKED`;
2. фиксирует статус `PROCESSING`;
3. закрывает транзакцию;
4. выполняет внешний вызов;
5. отдельной транзакцией записывает `SENT`, `RETRY` или `FAILED`.

Доставка имеет семантику at-least-once. Core обязан обрабатывать
`Idempotency-Key`. Зависшие записи `PROCESSING` автоматически возвращаются в
очередь.

## Realtime и Snapshot

`RealtimePublisher` читает только зафиксированные `realtime_events`.

- `InMemoryRealtimeHub` используется при одном процессе Domain API.
- `RedisRealtimeHub` используется при нескольких процессах или узлах.

WebSocket сначала получает актуальный snapshot, затем события вместе с новым
snapshot. Пропущенные события восстанавливаются через replay endpoint.

Роль не принимается из query-параметров. Principal создаётся доверенным
auth-слоем или проверкой Bearer API key. Перед snapshot, replay и WebSocket
доменная access policy проверяет доступ пользователя к конкретной сущности.

Snapshot Builder получает `ReadOnlySession`: изменения данных, flush и commit
запрещены. После чтения транзакция всегда откатывается и Session закрывается.

## Настройка realtime

Один процесс:

```text
FSM_REALTIME_BACKEND=memory
```

Несколько процессов:

```text
FSM_REALTIME_BACKEND=redis
FSM_REDIS_URL=redis://redis:6379/0
```

## Аутентификация MVP

Для встроенной проверки Bearer-токенов задаётся серверная конфигурация:

```json
{
  "client-secret": {
    "userId": 100,
    "roles": ["client"]
  },
  "driver-secret": {
    "userId": 205,
    "roles": ["driver"]
  }
}
```

JSON передаётся через `FSM_API_KEYS_JSON`. Если переменная отсутствует,
приложение ожидает `Principal` от внешнего middleware и не разрешает
анонимный доступ.

## Проверка

Быстрые тесты:

```bash
python -m unittest discover -s tests -v
```

Полный стенд с настоящими MySQL 8 и Redis 7:

```bash
./tests/run_platform_integration.sh
```

Стенд проверяет:

- полный путь Worker -> ХП -> Outbox -> Realtime -> Snapshot;
- конкурентные переходы и `TRANSITION_CONFLICT`;
- сохранение двух параллельных trigger;
- идемпотентность и повторную доставку Outbox;
- восстановление зависших Worker/Outbox-задач;
- обмен событиями между двумя Redis realtime-hub.
