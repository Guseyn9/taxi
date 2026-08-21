# AQ: Command Completion для asynchronous Command API

**Статус:** ACCEPTED
**Дата решения:** 2026-08-16
**Область:** Platform Core / Platform Interface
**Тип:** Architecture Question
**Приоритет:** Требует серверной реализации для финальной интеграции asynchronous Command API

## 1. Контекст

В ходе миграции Passenger Web Channel на Platform Core реализовано взаимодействие:

```text
Interaction Action
        ↓
   Command API
        ↓
      enqueue
        ↓
      worker
        ↓
       FSM
```

Command API является асинхронным.

Текущий серверный контракт подтверждает только постановку команды в очередь:

* `202 Accepted` — команда принята и поставлена в очередь;
* `200 duplicate` — обнаружен ранее использованный `Idempotency-Key`, возвращается сохранённый статус операции `PENDING`.

Ни один из этих ответов не означает успешного завершения FSM transition.

## 2. Обнаруженный архитектурный пробел

После получения `202 Accepted` Platform Channel должен иметь возможность определить результат выполнения **конкретного command instance**.

В текущем контракте отсутствует нормативный механизм, позволяющий однозначно установить completion конкретного `instanceId`.

В частности, отсутствует:

* Command Status API, коррелированный с `instanceId`;
* realtime completion event, содержащий `instanceId`, `commandId` или иной correlation identifier;
* нормативная связь `instanceId` с изменением состояния в Driver/Passenger Snapshot.

## 3. Почему Snapshot недостаточен

Snapshot отражает текущее состояние домена, но не факт выполнения конкретной команды.

Например:

```text
текущее состояние = order_in_ride

отправлена команда = start
instanceId = ABC
```

Наблюдение `order_in_ride` после отправки команды не доказывает, что именно `instanceId=ABC` выполнил transition.

Состояние могло:

* существовать до отправки команды;
* быть достигнуто другой командой;
* быть изменено другим процессом;
* быть достигнуто в результате повторной операции.

Поэтому Snapshot не может использоваться как нормативное подтверждение completion конкретного asynchronous command instance.

## 4. Решённый вопрос

Какой механизм Platform Command API является нормативным для определения результата выполнения конкретного asynchronous `instanceId`?

Принято решение использовать Command Status API по `instanceId` как единый
публичный контракт.

## 5. Принятое решение

**Command Status API по `instanceId` является нормативным механизмом Command Completion:**

```http
GET /api/commands/{instanceId}
```

с минимальным набором статусов:

```text
PENDING
PROCESSING
COMPLETED
FAILED
```

### Семантика

#### PENDING

Команда принята и зарегистрирована, но ещё не начала выполняться.

Не является успешным завершением.

#### PROCESSING

Команда передана worker'у и находится в процессе выполнения.

Не является успешным завершением.

#### COMPLETED

Конкретный `instanceId` успешно выполнил требуемую command semantics / FSM transition.

Это единственный статус, который должен считаться успешным completion команды.

#### FAILED

Выполнение конкретного `instanceId` завершилось ошибкой.

Ответ должен содержать машинно-обрабатываемый `errorCode`; текстовое описание ошибки является дополнительным.

Пример:

```json
{
  "instanceId": "abc",
  "status": "FAILED",
  "errorCode": "INVALID_TRANSITION"
}
```

## 6. Idempotency-Key

Повторная отправка команды с тем же `Idempotency-Key` не должна создавать новый command instance.

Она должна возвращать тот же `instanceId` и актуальный статус существующей операции.

Пример:

```text
Первая отправка:
    202 Accepted
    instanceId = ABC
    status = PENDING

Повторная отправка:
    200 duplicate
    instanceId = ABC
    status = PENDING

После выполнения:
    GET /api/commands/ABC
    status = COMPLETED
```

Таким образом retry после сетевого timeout остаётся безопасным.

## 7. Случай, когда target state уже существует

Если до отправки команды целевое состояние уже достигнуто, Platform Channel не должен самостоятельно считать команду выполненной.

Например:

```text
Snapshot:
    orderState = order_in_ride

Command:
    start
    instanceId = ABC
```

Наличие `order_in_ride` не является доказательством `COMPLETED` для `ABC`.

Если сервер рассматривает такую команду как успешно идемпотентную, это должно быть явно отражено в результате выполнения конкретного `instanceId`.

Если команда недопустима в текущем состоянии, результат должен быть `FAILED` с соответствующим `errorCode`.

## 8. Realtime

Realtime completion event может использоваться как дополнительный механизм доставки результата:

```text
command.completed(instanceId)
command.failed(instanceId)
```

Однако realtime event не должен быть единственным нормативным источником состояния command execution.

После reconnect Platform Channel должен иметь возможность восстановить результат операции через Command Status API.

Таким образом:

```text
Command API
    ↓
instanceId
    ↓
Command Status API ← source of truth
    ↑
Realtime notification
```

Realtime используется для оперативного уведомления, Command Status API — для достоверного восстановления состояния.

## 9. Требуемый контракт

Необходимо определить и задокументировать:

1. Endpoint получения статуса command instance.
2. Формат ответа.
3. Полный набор terminal/non-terminal статусов.
4. Семантику `COMPLETED`.
5. Семантику `FAILED`.
6. Машинные `errorCode`.
7. Поведение при повторном `Idempotency-Key`.
8. Поведение при уже достигнутом target state.
9. Retention периода для `instanceId`.
10. Возможность получения результата после reconnect/retry.
11. При наличии realtime — формат completion event и его correlation identifier.

## 10. Ограничения текущей реализации

До появления нормативного Command Completion contract Passenger Web может подтверждать только:

* принятие команды сервером;
* наблюдаемое изменение Snapshot.

Passenger Web **не должен трактовать**:

```text
202 Accepted → command success
```

и не должен трактовать:

```text
target state observed → command instance completed
```

как доказательство выполнения конкретного `instanceId`.

Временная эвристика на стороне Platform Channel не вводится.

## 11. Влияние на текущую работу

Данный AQ не требует изменения архитектуры Platform Interface или Platform Core со стороны команды миграции.

До реализации принятого решения:

* Query/Snapshot интеграция может продолжаться;
* Realtime transport может продолжать развиваться;
* Command enqueue может использоваться;
* UI может отображать состояние `pending`.

Окончательное подтверждение asynchronous command completion откладывается до
реализации нормативного серверного контракта из TASK-CORE-001.

## 12. Статус реализации решения

Архитектурный вопрос закрыт принятием Command Status API. Серверная реализация
решения вынесена в [TASK-CORE-001](../TASK_CORE_001_COMMAND_COMPLETION.md) и должна
позволить Platform Channel однозначно определить:

```text
instanceId
    ↓
PENDING / PROCESSING
    ↓
COMPLETED / FAILED
```

и определить результат конкретной команды независимо от:

* текущего Snapshot;
* повторной отправки Idempotency-Key;
* reconnect;
* уже существовавшего target state.

## 13. Нормативное архитектурное решение

**Command Status API по `instanceId` принят как нормативный механизм Command Completion.**

Realtime completion event использовать как дополнительный механизм уведомления.

Snapshot не использовать для определения completion конкретного command instance.

После принятия данного решения серверная реализация Command API и Platform Interface могут быть доведены до единой модели без внесения эвристик в Platform Channel.
