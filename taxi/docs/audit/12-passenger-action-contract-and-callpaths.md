# 12. Пассажирские команды: покрытие Action Contract и реальные UI call paths

## 1. База и метод

Проверен только commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf` выбранной ветки `main`. Локальная QA-версия не используется. Ветка `review/10-qa-review` исключена.

Проверка включает:
- `src/platform/platform-interface/surfaces/passenger/passengerActions.ts`;
- `src/platform/adapters/LegacyPassengerGateway.ts`;
- `src/platform/adapters/LegacyBackendGateway.ts`;
- найденные UI call sites в `VotingForm`, `PassengerLiveOrder`, модальных компонентах;
- API-методы, к которым адаптер делегирует выполнение.

Это статический анализ выбранного frontend commit. Реальные ответы backend, production runtime composition и выполнение всех ветвей UI здесь не запускались.

## 2. Реальный маршрут поддержанных пассажирских мутаций

В `LegacyPassengerGateway` есть семь публичных методов, которые преобразуют вызов UI в Interaction Action, ждут коррелированное событие и выполняют legacy API в зарегистрированном handler:

| Метод Gateway | Action | Legacy backend method | Найденные UI call sites |
|---|---|---|---|
| `createOrder` | `order_create` | `postDrive` | `VotingForm.tsx` (тип onSubmit и поток создания) |
| `cancelOrder` | `order_cancel_by_client` | `cancelDrive` | `VotingForm.tsx`; `DriverCancelModal.tsx` — driver cancellation uses passenger gateway in legacy code path |
| `selectCandidate` | `order_select_candidate` | `chooseCandidate` | `VoteModal.tsx`, `CandidatesModal.tsx`, `VotingForm.tsx`, `PassengerLiveOrder/index.tsx` |
| `releaseCandidate` | `order_release_candidate` | `releaseCandidateChoice` | `VotingForm.tsx`, `PassengerLiveOrder/index.tsx` |
| `updateWaitingTime` | `order_update_waiting_time` | `setWaitingTime` | `VoteModal.tsx`, `VotingForm.tsx`, `PassengerLiveOrder/index.tsx` |
| `updateCustomerPrice` | `order_update_customer_price` | `updateOrderCustomerPrice` | `VotingForm.tsx` |
| `completeRide` | `order_complete_ride` | `setOrderState(..., Finished)` | `OnTheWayModal.tsx`, `VotingForm.tsx`, `PassengerLiveOrder/index.tsx` |

Пассажирские UI-вызовы проходят через `LegacyPassengerGateway`, затем через `PlatformInterfaceRuntime`, обработчик адаптера и legacy API. Но это не означает, что backend-команды уже переведены на серверный Passenger Command API: адаптер всё ещё исполняет старые HTTP-методы.

## 3. API-12-01 — Action Contract шире, чем набор исполняемых команд Gateway

**Наблюдение в source:**

`passengerActions.ts` объявляет 12 действий:

- `order_create`
- `order_cancel_by_client`
- `order_select_candidate`
- `order_select_offer`
- `order_release_candidate`
- `order_update_waiting_time`
- `order_update_customer_price`
- `order_complete_ride`
- `order_open_chat`
- `order_confirm_boarding`
- `order_create_incident`
- `order_rate`

При этом `LegacyPassengerGateway.MUTATION_ACTIONS` регистрирует handler только для семи действий: CreateOrder, CancelOrder, SelectCandidate, ReleaseCandidate, UpdateWaitingTime, UpdateCustomerPrice и CompleteRide. В `executeLegacyMutation` также реализованы только эти семь ветвей.

Для `AcceptOffer`, `OpenChat`, `ConfirmBoarding`, `CreateIncident`, `RateOrder` в этом адаптере нет legacy handler и нет соответствующего публичного метода Gateway.

В то же время `LegacyReduxSnapshotProvider` включает некоторые из этих действий в `availableActions` по состоянию заказа, а `PassengerSurface` использует их для расчёта доступности UI-блоков.

**Что доказано:** декларация Action Contract и набор исполняемых legacy-команд не совпадают. Наличие действия в `availableActions` само по себе не доказывает, что команда уже реализована в Gateway.

**Что не доказано:** что UI действительно отправляет каждое неподдержанное действие в Runtime и что пользователь уже может попасть в зависшее состояние. Для такого вывода нужно проверить конкретный обработчик клика/dispatch в Passenger Surface и фактический runtime composition.

**Риск:** если неподдержанное действие будет отправлено в Runtime, текущий `LegacyPassengerGateway.handleAction` его проигнорирует, поскольку action type отсутствует в `MUTATION_ACTIONS`. Для такого вызова не будет опубликовано ни `CommandCompleted`, ни `CommandFailed`; вызывающая сторона, ожидающая коррелированный ответ, может остаться в ожидании. Это условный, но технически конкретный риск контракта.

**Рекомендация:** составить единый реестр `declared → advertised → dispatched → handled → backend-confirmed` для всех 12 действий. До реализации handler либо не рекламировать неподдержанные команды как доступные, либо направлять их в отдельный реализованный capability handler. Добавить тест, который проверяет полноту покрытия advertised actions.

## 4. API-12-02 — Рейтинг выполняется через LegacyBackendGateway в обход Passenger Action path

**Наблюдение в source:**

`RatingModal.tsx` вызывает `backendGateway.setOrderRating(_orderID, stars)` напрямую. В `passengerActions.ts` существует `RateOrder`, но `LegacyPassengerGateway` не включает его в поддержанные мутации и не предоставляет метода `rateOrder`.

Таким образом, рейтинг — реальный legacy API вызов через общий backend adapter, но не Passenger Interaction Action с коррелированными Passenger success/failure events.

Это согласуется с ранее зафиксированным FLOW-07/FLOW-08: комментарий/чаевые собираются UI, но в вызов API передаются только `stars`; модальное окно закрывается до получения ответа, а ошибка обрабатывается через flow log. Наличие `backendGateway` нормализует backend response/error, но не превращает этот путь в Passenger Action flow.

**Риск:** граница Passenger PI неполная и не единообразна. Наблюдаемость, корреляция команд и обработка результата рейтинга отличаются от семи мутаций, проходящих через Passenger Gateway.

**Рекомендация:** либо добавить `rateOrder` в Passenger Gateway и обработчик, либо документировать рейтинг как осознанное исключение с отдельным контрактом. Отдельно решить судьбу comment/tips: не считать их сохранёнными, пока payload backend метода не принимает эти данные.

## 5. Уточнение по отмене заказа водителем

В выбранном baseline `src/components/modals/DriverTripCancelModal.tsx` импортирует `driverMapGateway` и вызывает `driverMapGateway.cancel(orderId, reason)`. Это не прямой вызов `API.cancelDrive`.

В `DriverMapGateway` legacy handler для Cancel вызывает `backendGateway.cancelDrive(orderId, reason)`; при настроенном FSM command transport lifecycle cancel может пойти по серверному FSM пути.

Следовательно, старые формулировки в некоторых migration-документах о прямом вызове `API.cancelDrive` из `DriverTripCancelModal` устарели относительно выбранного main. Не регистрировать это как текущий bypass без нового call-site evidence.

## 6. Тестовое покрытие и его пределы

Найден тест `src/platform/adapters/__tests__/LegacyPassengerGateway.test.js`, проверяющий делегирование и коррелированные события для Gateway. Он подтверждает отдельные обработанные сценарии, но не доказывает полноту реализации всех Action Contract значений.

Поиск по action names обнаруживает декларации и их использование в UI-проекциях, но не заменяет проверку всех dispatch call sites. Запуск тестов в рамках этого этапа не выполнялся.

Нужны:
1. Табличный тест полноты: каждый advertised action имеет зарегистрированный handler и terminal event.
2. Тест неподдержанного action: явный failure event вместо молчаливого игнорирования, если Runtime допускает его dispatch.
3. Отдельный тест рейтинга: success/failure UI feedback и передаваемые поля.
4. Integration test на фактическом runtime composition для AcceptOffer, OpenChat, ConfirmBoarding, CreateIncident и RateOrder.

## 7. Приоритеты

| ID | Приоритет | Вывод | Следующее действие |
|---|---|---|---|
| API-12-01 | High, conditional | 12 объявленных действий против 7 обработанных Gateway actions; неподдержанные dispatch могут остаться без terminal event | Сопоставить advertised UI actions с реальными dispatch handlers; добавить completeness test |
| API-12-02 | Medium | Рейтинг идёт через backendGateway напрямую, хотя RateOrder объявлен в Passenger Action Contract | Перевести в Gateway или зафиксировать исключение; тестировать payload и feedback |
| DOC-12-01 | Low | Migration docs содержат устаревшее утверждение о прямом API.cancelDrive в DriverTripCancelModal | Синхронизировать migration documentation с main |

## 8. Вывод

Семь основных пассажирских мутаций имеют прослеживаемый путь через Passenger Gateway к legacy API. Полного перехода на серверный Passenger Command API нет. Action Contract объявляет дополнительные действия, для которых legacy gateway handler не найден; прежде чем считать их работоспособными, нужно проследить конкретные UI dispatch и runtime handlers. Рейтинг — отдельный прямой путь через LegacyBackendGateway. DriverTripCancelModal уже использует DriverMapGateway и не является подтверждённым прямым API bypass в выбранном baseline.
