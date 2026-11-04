# 14. Passenger UI: Chat, SOS, Rating и достижимость экранов

## 1. База и границы

Проверен только main commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`. QA worktree не используется. Статический анализ исходников; внешняя chat service и production runtime не проверялись.

## 2. CHAT-14-01 — Чат имеет отдельный рабочий legacy realtime путь

**UI entrypoint:** `MiniOrders/index.tsx` рендерит `ChatToggler` для выбранного заказа при наличии водителя и когда UI-state допускает чат.

**Открытие:** `Chat/Toggler.tsx` формирует идентификаторы `from = userId_orderId`, `to = anotherUserId_orderId`, переключает `activeChat` в Redux.

**Подключение:** `Chat/index.tsx` наблюдает `activeChat`, получает профиль собеседника через `chatGateway.getUser`, затем вызывает `chatGateway.connect`. `LegacyChatGateway` открывает WebSocket на `wss://chat.itest24.com:7007`, при открытии отправляет action=start, отправка сообщения использует action=send.

**Вывод:** чат не использует Passenger Action `order_open_chat` в найденном UI пути; он работает как отдельный realtime subsystem через LegacyChatGateway. Это не означает, что чат не работает, но Action Contract не является фактическим transport path.

**Предел проверки:** наличие reconnecting WebSocket client и обработчиков событий видно в коде, но доступность сервера, авторизация, доставка/сохранение сообщений и поведение при потере соединения в production не проверялись.

**Рекомендация:** добавить integration test с mock WebSocket на open/start, message/send, incoming message, close/reconnect/error; отдельно проверить реальный chat service и права на channel pair.

## 3. SOS-14-01 — SOS фактически является отменой заказа с причиной

**UI entrypoint:** кнопка SOS находится в `MiniOrders/index.tsx`, вызывает `setSosModal({isOpen:true, orderId})`. Найденная E2E документация подтверждает, что это единственная достижимая кнопка SOS на Passenger screen; `PassengerLiveOrder` не рендерится, а `OnTheWayModal` не открывается из текущего экрана.

**Submit:** `PassengerSosModal` требует выбранную причину, блокирует повторное нажатие, вызывает `submitPassengerSos(cancelOrder, orderId, reasonLabel)`. Redux `ordersActionCreators.cancel` ведёт к `API.cancelDrive` через mutation thunk. `submitPassengerSos` проверяет `code === '200'` и отсутствие `status === 'error'`, поскольку backend может возвращать бизнес-ошибку при HTTP 200.

**UI result:** только после подтверждённого успеха закрываются модальные окна, очищается выбранный заказ и обновляется список. При ошибке сохраняется SOS modal, снимается loading и показывается failure message.

**Вывод:** SOS — не отдельная emergency/incident backend capability, а существующая команда `set_cancel_state` с причиной отмены. Это важно для продукта и юридического/операционного описания функции: по исходникам нельзя обещать вызов экстренных служб, передачу геопозиции или специальный incident workflow.

**Рекомендация:** называть это «срочная отмена поездки с причиной», пока backend/операционный процесс не подтверждает отдельную обработку инцидента. Если SOS должен быть реальным инцидентом, требуется отдельный backend endpoint, аудит/уведомления и E2E проверка.

## 4. RATE-14-01 — Rating теряет введённые tips/comment и закрывает форму до ответа API

**UI:** `RatingModal` хранит `stars`, `tips`, `comment`. Кнопка активна при `stars !== 0`.

**Payload:** обработчик вызывает только `backendGateway.setOrderRating(_orderID, stars)`. Вызов не включает `tips` или `comment`. В исходнике прямо оставлен TODO `connect to API` у полей ввода.

**Failure handling:** вызов API выполняется асинхронно с `.catch`, который пишет flow event и console error. После запуска запроса `setRatingModal({isOpen:false})` вызывается немедленно, независимо от результата. Пользователь не получает видимый retry/error state, а введённые данные теряются при закрытии.

**Вывод:** подтверждён дефект функционального контракта: UI предлагает дополнительные поля, но не сохраняет их через текущий API вызов. Также пользовательский интерфейс не различает успешную и неуспешную отправку рейтинга.

**Рекомендация:**
1. Если backend поддерживает только stars — убрать/отключить tips/comment или явно сообщить, что эти поля пока не отправляются.
2. Если бизнес требует эти данные — расширить backend API и контракт payload, затем проверить сохранение чтением заказа/отзыва.
3. Закрывать modal только после подтверждённого success; при failure оставлять введённые значения и показывать retry/error.
4. Не логировать `REVIEW_SUBMITTED` до ответа сервера; разделить `REVIEW_SUBMIT_REQUESTED` и `REVIEW_SUBMIT_CONFIRMED`.

## 5. FLOW-14-02 — несколько путей завершения и показа рейтинга

В `MiniOrders` обработчик завершения вызывает `driverMapGateway.finish(orderId)`, после success открывает RatingModal; при ошибке показывает message modal и сбрасывает loading.

В `VotingForm` и `PassengerLiveOrder` завершение вызывается через `passengerGateway.completeRide`; после success обновляется список и открывается RatingModal. `PassengerLiveOrder` при этом не рендерится в текущем Passenger screen, поскольку `showLiveOrderPanel = false`.

В `Passenger/index.tsx` есть отдельный автоматический путь открытия рейтинга при обнаружении Finished state в activeOrders или после повторного чтения исчезнувшего заказа.

**Риск:** один и тот же review modal может быть открыт несколькими независимыми триггерами (прямое действие и наблюдение состояния). Есть локальная защита `finishedRatingShownRef` для state-observer пути, но в коде этого этапа не доказано глобальное idempotency поведение для всех trigger combinations.

**Рекомендация:** проверить duplicate-open и duplicate-submit на одном orderId; ввести единую идемпотентную функцию requestRating(orderId, source) и единый статус review pending/submitted.

## 6. API-14-03 — Action Contract расходится с фактическим отдельным subsystem

- `order_open_chat` объявлен в Passenger Action Contract и используется как metadata видимости chatButton; фактический click путь через `ChatToggler → activeChat Redux → Chat → LegacyChatGateway`.
- `order_create_incident` объявлен и используется для видимости SOS block; фактический путь через `PassengerSosModal → ordersActionCreators.cancel → API.cancelDrive`.
- `order_rate` объявлен, но фактический submit через `backendGateway.setOrderRating`, напрямую, без Passenger Gateway.

Это не просто отсутствие методов в одном Gateway: три пользовательские функции имеют самостоятельные legacy pathways, не представленные как единый Passenger command execution path.

## 7. Статус

| ID | Приоритет | Наблюдение | Статус |
|---|---|---|---|
| CHAT-14-01 | Medium | Чат — отдельный WebSocket subsystem; серверная доступность и delivery не проверены | Source path traced |
| SOS-14-01 | High (product semantics) | SOS вызывает отмену заказа с причиной, не отдельный incident response | Source path traced; backend semantics limited |
| RATE-14-01 | High | Tips/comment не передаются; modal закрывается до результата API | Confirmed source defect |
| FLOW-14-02 | Medium | Несколько триггеров открытия рейтинга; глобальная идемпотентность не доказана | Needs runtime test |
| API-14-03 | Medium | Chat/SOS/Rating обходят единый Passenger command path | Confirmed architecture split |

## 8. Что проверить следующим

1. Установить фактические E2E сценарии и тесты для Chat/SOS/Rating, отделяя unit mocks от живого backend.
2. Проверить API contract `setOrderRating`: допустимые поля и фактический ответ.
3. Проверить серверное значение cancel reason для SOS и какие уведомления/операционные действия запускаются.
4. Проверить chat WebSocket auth, reconnect, message ordering/deduplication и отсутствие утечки channel identifiers.
5. Проверить единый lifecycle рейтинга на повторные открытия и повторную отправку.
