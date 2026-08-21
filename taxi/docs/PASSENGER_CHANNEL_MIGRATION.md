# Миграция Passenger Channel

**Статус:** локально доступный этап выполнен  
**Дата:** 2026-08-13

## Что изменено

Основные компоненты Passenger Channel больше не импортируют Redux и структуру
legacy state напрямую:

- `pages/Passenger/index.tsx`;
- `pages/Passenger/VotingForm.tsx`;
- `components/PassengerLiveOrder/index.tsx`.

Временное чтение legacy state изолировано в
`LegacyPassengerChannelStoreAdapter`. После появления полного Passenger Snapshot
этот адаптер можно заменить, не меняя компоненты канала.

Пассажирские мутации проходят по единому пути:

```text
Passenger UI
  -> Interaction Action
  -> Platform Interface Runtime
  -> LegacyPassengerGateway handler
  -> legacy backend API
  -> correlated success/failure Event
  -> Snapshot refresh
```

Через этот путь выполняются:

- создание и отмена заказа;
- выбор и освобождение кандидата;
- изменение времени ожидания;
- изменение цены пассажира;
- завершение поездки.

Старый backend остаётся только реализацией временного outgoing adapter. После
готовности серверного Command API обработчик можно заменить без изменения UI и
Interaction Contract.

## Что остаётся временным

- `LegacyReduxSnapshotProvider` и `LegacyPassengerChannelStoreAdapter` читают
  Redux до появления полного Passenger Snapshot API;
- query-запросы геокодинга, пользователя, автомобиля и отдельного заказа идут
  через legacy backend adapter;
- модалки и polling заказов пока инициируются существующими Redux actions;
- серверный `availableActions` доступен только для подключённого snapshot
  конкретного заказа, полного Passenger Snapshot пока нет.

Это migration bridge, а не новая бизнес-логика Platform Interface.

## Внешние зависимости следующего этапа

Для полного отказа Passenger Channel от legacy state/backend нужны:

1. Passenger Snapshot API со списком заказов, выбранным заказом, пассажиром,
   кандидатами и `availableActions`.
2. Command API для пассажирских команд с идемпотентностью и нормализованными
   ошибками.
3. Realtime-события Passenger aggregate и браузерно-совместимая авторизация
   WebSocket.
4. Тестовый сервер, CORS и тестовые учётные данные для живого E2E.

## Проверка границы

`PassengerChannelBoundary.test.js` запрещает возвращать прямые импорты Redux и
legacy state в основные Passenger-компоненты. Контрактные тесты Gateway проверяют
Action, успешный Event, ошибочный Event, возврат результата и преобразование
команды завершения поездки.
