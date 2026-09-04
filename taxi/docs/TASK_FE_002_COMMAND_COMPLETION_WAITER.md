# TASK-FE-002: Подготовка Command Completion

**Статус:** Выполнено, нормативный transport подключён после TASK-CORE-001
**Дата:** 2026-08-17
**Область:** внутренняя реализация Driver Channel

## Цель

Подготовить frontend к замене временного Snapshot-based Command Completion на
нормативный Command Status API из `TASK-CORE-001`, не меняя текущие публичные
контракты Platform Interface и пользовательское поведение.

## Что изменено

Completion-логика вынесена из `DriverMapGateway` в отдельную внутреннюю границу:

```text
DriverMapGateway
    -> CommandAccepted(instanceId)
    -> DriverCommandCompletionWaiter
    -> COMPLETED / FAILED / TIMEOUT
```

Текущая реализация `SnapshotDriverCommandCompletionWaiter`:

- сохраняет `instanceId` принятой команды;
- временно наблюдает Driver/Order Snapshot;
- не считает target state, существовавший до команды, новым completion;
- использует один pending waiter для повторного `instanceId`;
- возвращает единый внутренний результат `COMPLETED`, `FAILED` или `TIMEOUT`;
- удаляет runtime-подписку и timeout после terminal result;
- отменяет незавершённые ожидания при unmount последнего Gateway consumer.

`DriverMapGateway` теперь отвечает только за:

- создание и dispatch Interaction Action;
- получение `CommandAccepted`;
- передачу `instanceId` completion-механизму;
- преобразование terminal result в существующую Promise/error семантику UI.

## Что не изменено

- Platform Core;
- Platform Interface public API;
- Interaction Contract;
- Surface Model;
- серверные endpoint;
- legacy fallback.

Snapshot-based completion сохранён только как fallback для окружений без
настроенного FSM API.

## Реализация после TASK-CORE-001

После реализации `TASK-CORE-001` добавлены `FsmCommandStatusTransport` и
`CommandStatusDriverCommandCompletionWaiter`:

```text
CommandAccepted(instanceId)
    -> GET /api/commands/{instanceId}
    -> PENDING / PROCESSING
    -> COMPLETED / FAILED
```

`DriverMapGateway`, Interaction Action и UI при этой замене не изменились.
Нормативный waiter включается только при одновременной конфигурации
`REACT_APP_FSM_API_URL` и `REACT_APP_FSM_COMMAND_STATUS_ENABLED=true`.
Это позволяет выкатывать Query/Command и Command Status независимо; до включения
флага сохраняется Snapshot-based fallback.

`TASK-CORE-001 §8` определяет `404` как неизвестный `instanceId`, а не временную
ошибку сервера. Внутренний result различает серверный execution `FAILED` и ошибку
чтения Command Status через `failureKind=EXECUTION|STATUS_LOOKUP`.

## Проверка

Покрыты сценарии:

- Accepted передаёт `instanceId` waiter-у;
- duplicate использует тот же pending completion path;
- Snapshot completion;
- Command Status polling `PENDING / PROCESSING -> COMPLETED / FAILED`;
- HTTP и protocol errors Command Status;
- retry после временной ошибки `5xx`;
- timeout;
- failed completion;
- target state до команды не считается completion;
- cleanup подписки после terminal result.
