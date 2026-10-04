# TASK-FE-003: инвентаризация действий Driver

## Результат

В рамках задачи проверены действия Driver и существующие точки интеграции.
Переведены только те действия, для которых уже есть серверный intent и общий
Command API runtime. Новые серверные или Platform Interface контракты не
добавлялись.

## Действия

| Действие UI | Текущий legacy-вызов | Command API | Optimistic state | Решение |
|---|---|---|---|---|
| Приехал (`driver.order.arrive`) | `setOrderState`, для VOTE также `arrivedVotingOrder` | Поддержан intent `driver_arrived` | Нет: событие успеха только после `COMPLETED` | Переведено через общий Command API и completion waiter |
| Начал поездку (`driver.order.start`) | `setOrderState` | Поддержан intent `ride_started` | Нет: событие успеха только после `COMPLETED` | Переведено через общий Command API и completion waiter |
| Подтвердил посадку (`driver.order.confirm_boarding`) | `confirmVotingCode` и `setOrderState` | Маппится на `ride_started`, payload содержит `boardingCode` | Нет: событие успеха только после `COMPLETED` | Переведено через общий Command API и completion waiter |
| Завершил поездку (`driver.order.finish`) | `setOrderState` | Поддержан intent `ride_finished` | Нет: событие успеха только после `COMPLETED` | Переведено через общий Command API и completion waiter |
| Отмена/прерывание (`driver.order.cancel`) | `cancelDrive` | `cancel_requested` для водителя сейчас запрещён сервером | Локальная метка водителя; снимается при ошибке | Оставлено на legacy fallback до отдельной серверной задачи |
| Принятие DIRECT/VOTE/OFFER | `takeOrder`, `participateVotingOrder`, `sendOrderOffer` | Нормативный набор Driver intents и completion states не утверждён | Нет | Не менять в этой задаче |
| Профиль, автомобиль, геокодирование, маршрутизация | Legacy API и локальные провайдеры | Соответствующих PI capabilities нет | Нет | Оставить без изменений |

## Общий путь поддержанных действий

Для arrive, start, confirm boarding и finish используется единый путь:

```text
DriverMapGateway
  -> FsmTaxiCommandTransport
  -> POST /api/commands/taxi/order/{orderId}
  -> accepted.instanceId
  -> DriverCommandCompletionWaiter
  -> GET /api/commands/{instanceId}
  -> COMPLETED / FAILED / TIMEOUT / CANCELLED
```

UI actions преобразуются в канонические серверные intents в `DriverMapGateway`:
`driver.order.arrive` -> `driver_arrived`, `driver.order.start` и
`driver.order.confirm_boarding` -> `ride_started`, `driver.order.finish` ->
`ride_finished`. `FsmTaxiCommandTransport` отправляет полученный intent без
дополнительного преобразования.

`202 Accepted` не считается завершением перехода. Успешное событие Driver
публикуется только после `COMPLETED`. При недоступном rollout-контракте
сохраняется существующий Snapshot-based completion, а при отсутствии Command
API остаётся legacy путь.

## Почему cancel не переводится сейчас

В текущей серверной версии роль водителя не авторизована для `cancel_requested`:
отправка водительской отмены через Command API даёт 403. Серверная задача должна
определить и реализовать утверждённый водительский intent для отмены; нынешнее
ограничение роли не определяет постоянную семантику `cancel_requested`.

После появления утверждённого водительского intent и его completion semantics
отмену можно будет перевести отдельной задачей, не меняя общий completion
механизм.

## Проверки

- Command API path проверен для arrive, start, confirm boarding и finish через
  общий `DriverMapGateway` и реальные HTTP transport-классы. Проверяются
  фактические POST body, `instanceId` в GET и событие после `COMPLETED`.
- Проверено, что `202` и duplicate не считаются завершением сами по себе.
- Проверено, что driver cancel при настроенном Command API не отправляется в
  неподдержанный серверный intent и использует legacy fallback.
- Поддержанные действия используют один `DriverCommandCompletionWaiter`, без
  отдельных polling-механизмов.

## Ограничения задачи

В рамках TASK-FE-003 не изменяются Platform Core, Platform Interface, backend,
FSM-граф и бизнес-логика принятия заказов.
