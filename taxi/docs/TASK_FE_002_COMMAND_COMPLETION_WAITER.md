# TASK-FE-002: Подготовка Command Completion

**Статус:** Выполнено
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
- временная Snapshot-based completion-семантика;
- legacy fallback.

Новый `GET /api/commands/{instanceId}` не эмулируется и не предполагается
существующим.

## Следующая замена

После реализации `TASK-CORE-001` нужно добавить `CommandStatusTransport` и заменить
только реализацию `DriverCommandCompletionWaiter`:

```text
CommandAccepted(instanceId)
    -> GET /api/commands/{instanceId}
    -> PENDING / PROCESSING
    -> COMPLETED / FAILED
```

`DriverMapGateway`, Interaction Action и UI при этой замене меняться не должны.

## Проверка

Покрыты сценарии:

- Accepted передаёт `instanceId` waiter-у;
- duplicate использует тот же pending completion path;
- Snapshot completion;
- timeout;
- failed completion;
- target state до команды не считается completion;
- cleanup подписки после terminal result.
