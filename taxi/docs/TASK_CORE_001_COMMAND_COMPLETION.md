# TASK-CORE-001 — Command Completion для asynchronous Command API

**Статус:** APPROVED
**Основание:** принятое архитектурное решение AQ «Command Completion для asynchronous Command API»
**Область:** Platform Core / Server Command API
**Приоритет:** необходим для завершения интеграции Platform Interface

## 1. Цель

Реализовать нормативный серверный контракт, позволяющий Platform Channel определить результат выполнения **конкретного asynchronous Command execution** по его `instanceId`.

Реализация должна устранить неоднозначность между:

- принятием команды сервером;
- началом её выполнения;
- успешным завершением FSM transition;
- ошибкой выполнения.

`202 Accepted` и `200 duplicate` не должны трактоваться как успешное выполнение команды.

---

## 2. Требуемый публичный API

Добавить endpoint:

```http
GET /api/commands/{instanceId}
```

где `instanceId` — идентификатор конкретного execution, возвращённый Command API.

Endpoint должен возвращать текущее состояние выполнения команды.

### Минимальная модель

```json
{
  "instanceId": "abc-123",
  "status": "PENDING"
}
```

Допустимые статусы:

```text
PENDING
PROCESSING
COMPLETED
FAILED
```

---

## 3. Семантика статусов

### PENDING

Команда принята сервером и зарегистрирована, но выполнение ещё не началось.

`PENDING` не является успешным завершением.

### PROCESSING

Команда передана worker'у и находится в процессе выполнения.

`PROCESSING` не является успешным завершением.

### COMPLETED

Конкретный `instanceId` успешно завершил требуемую command semantics / FSM transition.

**Только `COMPLETED` является подтверждением успешного выполнения команды.**

### FAILED

Конкретный `instanceId` завершился неуспешно.

Ответ должен содержать машинно-обрабатываемый код ошибки.

Пример:

```json
{
  "instanceId": "abc-123",
  "status": "FAILED",
  "errorCode": "INVALID_TRANSITION"
}
```

Текстовое сообщение об ошибке является дополнительным и не должно использоваться как машинный идентификатор ошибки.

---

## 4. Связь с существующим Command API

Существующий Command API остаётся механизмом создания command execution.

Пример:

```text
POST /api/commands/taxi/order/{orderId}
        ↓
202 Accepted
        ↓
instanceId
```

Полученный `instanceId` должен однозначно соответствовать созданному execution.

После этого Platform Channel может запросить:

```text
GET /api/commands/{instanceId}
```

---

## 5. Idempotency-Key

Повторная отправка команды с тем же `Idempotency-Key` не должна создавать новый execution.

Она должна ссылаться на уже существующий execution.

Например:

```text
Первый запрос
    ↓
202 Accepted
instanceId = ABC
status = PENDING

Повторный запрос
    ↓
200 duplicate
instanceId = ABC
status = PENDING
```

`duplicate=true` или HTTP `200` **не означает `COMPLETED`**.

Для определения результата используется:

```text
GET /api/commands/ABC
```

---

## 6. Уже достигнутое target state

Нельзя определять результат команды только по текущему состоянию Snapshot.

Например:

```text
Snapshot:
orderState = order_in_ride

Command:
start
instanceId = ABC
```

Наличие `order_in_ride` до или после отправки команды не является доказательством того, что именно `ABC` выполнил transition.

Сервер должен определить результат конкретного execution.

Если серверная семантика допускает идемпотентное успешное завершение такой команды, результат должен быть:

```text
instanceId = ABC
status = COMPLETED
```

Если transition недопустим:

```text
instanceId = ABC
status = FAILED
errorCode = ...
```

Platform Channel не должен самостоятельно выводить эти результаты из Snapshot.

---

## 7. Ошибки

Минимально необходимо определить машинные `errorCode` для:

- недопустимого transition;
- неизвестного/недоступного объекта;
- невалидных параметров;
- отказа авторизации;
- внутренней ошибки выполнения;
- иных ошибок, которые сервер считает terminal failure.

Набор кодов должен быть документирован как часть публичного API.

---

## 8. Неизвестный `instanceId`

Для неизвестного `instanceId` API должен возвращать однозначный HTTP-ответ.

Рекомендуемый вариант:

```http
404 Not Found
```

Ответ должен позволять отличить:

- неизвестный `instanceId`;
- временную ошибку сервера.

---

## 9. Terminal states

`COMPLETED` и `FAILED` являются terminal states.

После перехода в terminal state статус конкретного `instanceId` не должен возвращаться в:

```text
PENDING
PROCESSING
```

и не должен изменяться на другой terminal state.

---

## 10. Persistence и retention

Статус execution должен сохраняться достаточно долго, чтобы Platform Channel мог получить результат после:

- задержки worker;
- временного отсутствия сети;
- reconnect;
- повторного запроса;
- восстановления после перезапуска клиента.

Конкретный срок retention необходимо определить в серверной реализации и задокументировать.

Удаление execution не должно происходить до окончания согласованного retention периода.

---

## 11. Realtime

В рамках этого ТЗ **Realtime completion event не является обязательным**.

Утверждённым нормативным механизмом является:

```text
GET /api/commands/{instanceId}
```

Realtime может быть реализован позднее как оптимизация доставки уведомления.

При наличии Realtime event он не должен менять семантику Command Status API.

После reconnect Platform Channel должен иметь возможность восстановить результат через Command Status API.

---

## 12. Без изменений Platform Interface

Серверная реализация не должна требовать от Platform Interface:

- определения FSM transition;
- анализа Snapshot для определения completion;
- хранения собственной серверной FSM;
- введения клиентской эвристики;
- создания второго Command lifecycle.

Platform Interface должен только потреблять нормативный серверный контракт.

---

## 13. Тестирование

Необходимо добавить server-side тесты минимум для следующих сценариев.

### Создание

```text
POST Command
→ 202
→ instanceId
→ GET instanceId
→ PENDING
```

### Выполнение

```text
POST Command
→ 202
→ instanceId
→ worker
→ FSM transition
→ GET instanceId
→ COMPLETED
```

### Ошибка

```text
POST Command
→ 202
→ instanceId
→ worker
→ FSM failure
→ GET instanceId
→ FAILED
```

### Duplicate

```text
POST Command
→ instanceId = ABC

POST same Idempotency-Key
→ duplicate
→ instanceId = ABC

GET ABC
→ актуальный статус существующего execution
```

### Target state уже существует

Проверить, что результат конкретного execution определяется сервером, а не выводится клиентом только из Snapshot.

### Unknown instance

```text
GET /api/commands/unknown
→ 404
```

### Terminal state

Проверить, что после `COMPLETED` или `FAILED` execution не возвращается в non-terminal state.

---

## 14. Совместимость

Реализация не должна ломать существующий контракт:

```text
POST /api/commands/taxi/order/{orderId}
```

Текущие:

- `202 Accepted`;
- `200 duplicate`;
- `Idempotency-Key`;
- `instanceId`;

должны продолжить работать согласно существующей семантике.

Новый endpoint добавляется как механизм получения результата выполнения.

---

## 15. Acceptance Criteria

TASK-CORE-001 считается выполненным, если:

- [ ] существует `GET /api/commands/{instanceId}`;
- [ ] endpoint возвращает `PENDING / PROCESSING / COMPLETED / FAILED`;
- [ ] `instanceId` однозначно коррелирован с execution;
- [ ] `COMPLETED` означает успешное завершение конкретного execution;
- [ ] `FAILED` содержит машинный `errorCode`;
- [ ] `202 Accepted` не означает `COMPLETED`;
- [ ] `200 duplicate` не означает `COMPLETED`;
- [ ] повторный `Idempotency-Key` не создаёт новый execution;
- [ ] target state не используется как самостоятельное доказательство completion;
- [ ] terminal state является стабильным;
- [ ] неизвестный `instanceId` обрабатывается определённым контрактом;
- [ ] retention определён;
- [ ] server-side тесты покрывают основной lifecycle;
- [ ] существующий Command API остаётся совместимым.

## 16. Результат

После выполнения TASK-CORE-001 Platform Core предоставляет полный нормативный lifecycle asynchronous Command:

```text
Action
  ↓
POST Command
  ↓
202 + instanceId
  ↓
PENDING
  ↓
PROCESSING
  ↓
COMPLETED / FAILED
```

Platform Interface после этого может реализовать Command Completion без эвристик и без зависимости от причинного анализа Snapshot.