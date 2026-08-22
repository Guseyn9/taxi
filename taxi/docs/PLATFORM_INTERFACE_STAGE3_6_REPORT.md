# Platform Interface: Driver, Passenger, Navigation и инфраструктура

**Статус:** реализован фронтовый объём пунктов 3–6 и транспорт существующих Query/Realtime API  
**Дата:** 2026-08-08

## 1. Navigation Runtime

Добавлены:

- `NavigationRegistry` с явной регистрацией маршрутов;
- транспортно-независимый `NavigationRuntime`;
- React Router bridge;
- синхронизация текущего location с состоянием Runtime;
- fail-fast ошибки для неизвестного route и отсутствующего adapter.

`Routes.tsx` получает пути из Navigation Registry. Сам Runtime не импортирует
React Router и может использоваться другим Platform Channel.

## 2. Passenger Surface

Локальный Passenger UI resolver перенесён за границу PI в
`surfaces/passenger/PassengerPresentation.ts`. Старый `pages/Passenger/uiFsm.ts`
оставлен как compatibility export для существующих тестов и импортов.

Passenger Screen теперь монтирует `PassengerSurface` и получает через него:

- UI state/config;
- `availableActions` из единого PI Snapshot (через временный Redux Provider до
  подключения серверного Query API);
- lifecycle и обновления Runtime.

Существующие Redux selectors передают в Surface факты через
`LegacyReduxSnapshotProvider` как временный migration bridge. Provider формирует
непустой Snapshot и `availableActions`, поэтому подключённый PI Runtime работает
уже сейчас, до появления серверного Query API.

Прямые вызовы backend из Passenger-компонентов вынесены в
`LegacyPassengerGateway`. Пассажирские мутации проходят через Interaction Action,
PI Runtime и коррелированные success/failure Events; legacy backend вызывается
только обработчиком временного адаптера. После команды Runtime обновляет Snapshot.
В дальнейшем обработчик Gateway заменяется на Command API серверного Domain FSM
без повторной переделки Passenger UI.

Прямые зависимости основных Passenger-компонентов от Redux также вынесены в
`LegacyPassengerChannelStoreAdapter`. Подробный статус и граница следующего этапа
описаны в `PASSENGER_CHANNEL_MIGRATION.md`.

## 3. Driver actions и backend boundary

Компоненты и страницы Driver/Passenger больше не импортируют `API.*` напрямую.
Единственная точка доступа UI к существующему backend —
`LegacyBackendGateway`. Он нормализует транспортные ошибки в
`BackendInteractionError` и публикует события завершения/отказа без утечки тела
backend-ответа.

Переходы заказа водителя выполняются через Action/Event gateway:

- `driver.order.arrive` → `driver.order.arrived`;
- `driver.order.start` → `driver.order.started`;
- `driver.order.confirm_boarding` → `driver.order.boarding_confirmed`;
- `driver.order.finish` → `driver.order.finished`;
- ошибка → `driver.order.action.failed`.

Этим gateway пользуются карта, карточка заказа, страница заказа и компактный
список активных поездок. UI оставляет за собой только отображение результата и
запрос обновлённого Snapshot.

Стратегия построения маршрута ORS → локальный дорожный граф → OSRM вынесена из
React-карты в `LegacyRouteProvider`; URL и fallback-логика больше не являются
ответственностью Map Channel.

## 4. Surface

В Registry зарегистрированы и подключены:

| Surface | ID | Точка использования |
|---|---|---|
| Map | `driver.map` | Driver Map |
| HUD | `driver.hud` | Driver Map |
| List | `driver.list` | Driver Orders |
| Simple | `passenger.simple` | Passenger Screen |
| Chat | `shared.chat` | Chat |

HUD и List читают пользователя и active/ready/history orders из Driver projection
единого Snapshot. Props сохранены только как bootstrap fallback для legacy Redux
Provider. Chat использует общий lifecycle PI и транспорт за gateway.

## 5. Инфраструктура

Реализованы:

- bootstrap validation обязательных Surface и маршрутов;
- `SwitchableSnapshotProvider` для подключения Domain API после запуска UI;
- `ReconnectingSnapshotTransport` с экспоненциальным backoff;
- общий `ReconnectingWebSocketClient` и chat gateway, поэтому Chat больше не
  знает адрес сервера и не создаёт WebSocket напрямую;
- отмена reconnect при unmount;
- защита query/realtime от устаревших ответов;
- единый цикл UI-действия: dispatch, обработчик, затем refresh Snapshot;
- интеграционный тест общего composition root;
- тесты рабочего Redux Provider, Passenger Gateway, Navigation Runtime,
  Driver/Passenger Snapshot projection, backend/Driver gateway, Snapshot Surface
  и reconnect WebSocket;
- тест 100 конкурентных refresh, подтверждающий правило «последний запрос
  определяет состояние».
- `FsmOrderSnapshotTransport` для существующих Query и WebSocket endpoint одного
  известного taxi/order;
- `FsmDriverSnapshotTransport` для агрегата водителя с временным Query recovery
  polling;
- `FsmTaxiCommandTransport` для Driver intents с idempotency key;
- отдельное событие принятия серверной команды: `202 Accepted` не выдаётся за
  завершённый lifecycle-переход;
- завершение Promise lifecycle-команды только после подтверждения целевого
  состояния через Driver/Order Snapshot;
- runtime-валидация HTTP-статуса и минимального Command Accepted contract;
- отсутствие синтетических доменных значений в partial Driver projection и
  сохранение серверного `driver.user`;
- фильтрация устаревших polling snapshot по `revision`, `updatedAt`, порядку Query
  и факту получения WS Snapshot во время запроса;
- автоматический выбор серверного Provider через переменные окружения;
- тесты первичного Query, realtime-обновления, reconnect, recovery snapshot,
  cleanup и нормализации HTTP-ошибок.

Актуальные результаты полной локальной проверки приведены в
`TASK_PI_001_QUERY_REALTIME.md`.

`SwitchableSnapshotProvider` позволяет подключить сервер без пересоздания PI:

```text
platformInterface.snapshotProvider.setProvider(
    new DomainApiSnapshotProvider(transport)
)
```

## 6. Оставшиеся внешние зависимости

Command API и Driver Snapshot API подключены. Для завершения живой интеграции
остались:

1. Расширить карточку Driver Snapshot адресами, координатами, временем и данными
   участников, необходимыми реальному Driver UI.
2. Проецировать order events в realtime-канал водителя; сейчас это компенсируется
   Query recovery polling.
3. Согласовать браузерно-совместимый способ авторизации WebSocket.
4. Предоставить URL, CORS и тестовые учётные данные интеграционного окружения.

После их появления меняются только transport, projection и command handlers.
Surface, Navigation Runtime и React-компоненты заново проектировать не требуется.
