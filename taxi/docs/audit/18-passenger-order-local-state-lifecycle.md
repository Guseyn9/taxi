# 18. Passenger order local state — rejection history, ETA, waiting extension and price

## 1. База и границы

Исходники проверены только на pinned `main` commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`. Stage 18 — статический анализ. Backend source и production runtime не доступны. Приложение не менялось; выводы о серверном сохранении ограничены тем, что можно установить по frontend request/response flow.

## 2. Краткий вывод

Локальное состояние заказа в этой части не является единым согласованным кешем:
- confirmed choice, rejected choices, pickup ETA и несколько вспомогательных значений хранятся в разных localStorage maps по order ID;
- startup cleanup удаляет эти карты при запуске приложения;
- очистка при отдельных пользовательских действиях неполная: confirmed choice очищается при release, но rejected history сохраняется; pickup ETA не имеет обнаруженного per-order cleanup;
- waiting extension helper существует, но в проверенном активном VotingForm flow не используется как подтверждённое локальное хранилище; компонент ведёт собственный React state и затем перечитывает order list;
- customer price override хранится только в React state до подтверждения/обновления заказа, с rollback при reject. Это предпочтительнее постоянного localStorage cache, но остаётся временным UI override.

## 3. Rejected choices — накопительная история без удаления по заказу

`addPassengerRejectedChoice(orderId, userId)` добавляет ID в массив `passengerRejectedDriverChoices[orderId]`, устраняя дубли. Найденные вызовы — в двух passenger UI компонентах после успешного backend release:
- `VotingForm.handleConfirmCancelSelectedDriver`;
- `PassengerLiveOrder` аналогичный cancel-selected-driver flow.

Оба обработчика сначала пытаются снять кандидата через backend (сначала с driver ID, затем без него). Только после успешного release они добавляют rejected ID, ставят timestamp перезапуска поиска и очищают confirmed choice.

В `driverOffer.ts` не найдено функции `clearPassengerRejectedChoices` или другого точечного удаления rejected ID/order. Следовательно, rejected history накапливается в течение сессии и используется при следующем выборе как список водителей, которых нужно попытаться освободить. Startup cleanup удаляет весь ключ при следующем запуске приложения.

Риск: повторный заказ/новая попытка с тем же order ID может унаследовать локальный rejected list до перезапуска; старые ID могут попадать в release loop. При уникальных и никогда не переиспользуемых order ID это ограничивает практический ущерб, но frontend не гарантирует такой жизненный цикл.

## 4. Confirmed choice и MiniOrders — ещё одна версия resolver

Stage 17 уже выявил различие VotingForm и PassengerLiveOrder. В Stage 18 обнаружен третий resolver: `MiniOrders.getActiveDriver` также читает local confirmed choice и возвращает запись с этим ID при любом состоянии, кроме Canceled. Это значит, что local fallback может влиять не только на подробную форму, но и на верхнюю карточку заказа.

При этом MiniOrders содержит отдельный комментарий о том, что backend/эмулятор может вернуть Performer ещё во время подбора, и до явного выбора пассажиром нельзя считать его назначением. Локальный confirmed choice обходится этим ограничением и становится приоритетным.

`clearPassengerConfirmedChoice` удаляет только confirmed ID и startedAt для данного order ID; rejected list, ETA, search-restart timestamp и прочие maps не очищаются этой функцией.

## 5. Pickup ETA — локальная производная, без TTL и per-order удаления

`setPassengerPickupEta` записывает ETA под двумя ключами вида `orderId:driverUserId` и `orderId:carId` в `passengerPickupEtaByOrderDriver`. Источник вызовов — `components/Map/index.tsx`, после расчёта маршрута до выбранного/активного водителя. Изменение публикуется через custom event `passengerPickupEtaChanged`; VotingForm слушает событие и обновляет версию для перерендера.

`getPassengerPickupEta` читает локальную строку и дополнительно проверяет её через `isSafePassengerPickupEta`. Значение — вычисленная клиентом оценка маршрута, а не серверное обещание времени прибытия.

В проверенном модуле не найдено удаления ETA для одного заказа/водителя. Startup cleanup удаляет весь ключ `passengerPickupEtaByOrderDriver`. При отмене/завершении заказа специальной очистки этой карты в найденных passenger handlers нет.

Риск умеренный: устаревшее ETA может остаться доступным в рамках сессии, если order ID/driver ID снова используется или UI запрашивает прежнюю пару. ETA должно считаться краткоживущим presentation cache и проверяться на актуальность относительно текущего маршрута/state.

## 6. Waiting extension — backend mutation плюс локальный UI state

Активный VotingForm handler отправляет:
- `previousWaitingTime = getChoiceOrderMaxWaitingSeconds(lockedOrder) + lockedWaitingExtensionSeconds`;
- `additionalTime = getChoiceWaitingIntervalSeconds()`;
- затем после resolve увеличивает React state `lockedWaitingExtensionSeconds`, показывает короткую индикацию успеха и вызывает `refreshActiveOrders()`.

На смене `lockedOrder.b_id` или `lockedOrder.b_max_waiting` компонент сбрасывает React state и вызывает `clearPassengerChoiceWaitingExtension(orderId)`.

В `driverOffer.ts` имеется отдельная localStorage map `passengerChoiceWaitingExtensionSeconds` с лимитом 27 минут и методами add/get/clear. Однако поиск call sites для `addPassengerChoiceWaitingExtensionSeconds` и `getPassengerChoiceWaitingExtensionSeconds` на pinned main не обнаружил использования вне их собственных определений. Следовательно, нельзя считать эту map действующим источником значения в рассматриваемом VotingForm пути.

API `setWaitingTime` отправляет `action=set_waiting_time`, previous и additional, но возвращает `res.data` без проверки `status === 'error'`. Поэтому HTTP 200 с бизнес-ошибкой может быть воспринят как успех, после чего UI увеличит локальный счётчик и покажет success. Backend readback не выполняется в том же обработчике; обновление списка происходит асинхронно.

## 7. Customer price — временный optimistic override, не долговременный cache

`handleLockedCustomerPriceCommit`:
1. нормализует цену и запрещает изменение при выбранном водителе, повторном сохранении или значении не выше текущего;
2. записывает override в React state и сразу обновляет PriceInput;
3. вызывает `passengerGateway.updateCustomerPrice(lockedOrder, safeValue)`;
4. при resolve обновляет active orders;
5. при reject удаляет override, возвращает прежнюю цену и показывает ошибку.

Override привязан к order ID; при переключении locked order сбрасывается. В localStorage его не найдено. Это не доказательство успешного backend persistence: обработчик не перечитывает конкретный заказ до показа результата, а полагается на успешный Promise и последующий refresh.

API отправляет `action=edit` с JSON из разрешённого набора `CUSTOMER_PRICE_EDIT_KEYS`; в отличие от `setWaitingTime`, wrapper явно отклоняет `res.status === 'error'`. Поэтому ложный success при HTTP-200 business error в price path менее вероятен на уровне wrapper.

## 8. Startup cleanup и жизненный цикл

`appCache.ts` включает в `BOOT_LOCAL_REMOVE_EXACT` следующие ключи:
- `passengerConfirmedDriverChoices`;
- `passengerConfirmedDriverChoiceStartedAt`;
- `passengerPickupEtaByOrderDriver`;
- `passengerRejectedDriverChoices`;
- `passengerChoiceOrderModes`;
- `passengerChoiceSearchRestartedAt`;
- `passengerChoiceWaitingExtensionSeconds`.

`resetStaleAppCache()` удаляет этот список при старте, независимо от того, изменилась ли версия сборки. Значит эти значения предназначены для краткоживущего состояния текущей browser session/build startup, а не для восстановления после полного перезапуска приложения. Сброс может быть неожиданным для пользователя, если backend не возвращает достаточный authoritative snapshot, но не должен рассматриваться как backend data loss.

Внутри открытой сессии отдельные maps не имеют TTL/общей уборки завершённых заказов. Это оставляет риск накопления записей и устаревших значений до следующего startup cleanup.

## 9. Multi-tab / multi-device

Код использует custom events для синхронизации компонентов в одном document. Для рассмотренных choice/ETA/waiting maps не найдено явных listeners на browser `storage` event. Поэтому другая вкладка может видеть изменённый localStorage при следующем чтении, но её уже инициализированный React state не обязан обновиться немедленно.

Между устройствами localStorage не синхронизируется. Реальное состояние выбора, времени ожидания и цены должно поступать из backend order snapshot. Локальные rejected list и ETA по своей природе не являются серверным состоянием.

## 10. Тестовое покрытие

По поиску в pinned main не найдены отдельные unit/E2E tests для:
- добавления/очистки rejected choice map и поведения повторного release;
- очистки pickup ETA при смене driver/order/terminal state;
- повторного открытия заказа после обновления страницы;
- конкурирующих обновлений в двух вкладках;
- успешного и HTTP-200 business-error ответа `set_waiting_time` с backend readback;
- customer price optimistic update, rollback и подтверждения значения после reload.

Наличие happy-path voting/offer E2E из Stage 16 не покрывает эти жизненные циклы и ошибки синхронизации.

## 11. Новые замечания

| ID | Приоритет | Замечание | Основание |
|---|---|---|---|
| PASS-18-01 | Medium | Rejected candidate IDs накапливаются по order ID; отдельного per-order clear не найдено | `driverOffer.ts`, оба passenger cancel handlers |
| PASS-18-02 | Medium | MiniOrders использует local confirmed choice как приоритетный driver resolver, включая non-Canceled состояния | `MiniOrders.getActiveDriver` |
| PASS-18-03 | Low/Medium | Pickup ETA — local derived cache без TTL/per-order cleanup; может пережить смену маршрута в рамках сессии | `driverOffer.ts`, Map call sites |
| PASS-18-04 | Medium | Waiting extension helper/storage существует, но не используется активным VotingForm path; реальный UI state in-memory и зависит от refresh/backend response | call-site search + VotingForm |
| PASS-18-05 | High | HTTP-200 `status=error` от `set_waiting_time` не отвергается wrapper; UI может показать ложный успех | `API/order.ts`, `VotingForm.tsx` |
| PASS-18-06 | Medium | Нет найденных тестов для rejected/ETA/waiting lifecycle, multi-tab и customer-price rollback/readback | test search |

## 12. Рекомендации

1. Свести выбранного водителя к одному shared resolver, основанному на backend snapshot и серверном state; локальный confirmed choice использовать только как pending hint.
2. Добавить per-order cleanup для rejected IDs, pickup ETA, search restart и других derived maps при terminal state/удалении заказа; предусмотреть TTL как защиту от пропущенных событий.
3. Не пытаться release IDs из старой rejected history без проверки, что соответствующая запись всё ещё присутствует в актуальном order snapshot и допускает release.
4. Исправить `setWaitingTime`: отклонять HTTP-200 business error, валидировать успешный ответ и проверять обновлённое backend значение перед отображением подтверждения.
5. Удалить неиспользуемую waiting-extension localStorage map или подключить её с ясным контрактом; сейчас она создаёт второй потенциальный источник правды без call sites.
6. Для ETA хранить timestamp/route identity вместе со строкой, сбрасывать при изменении driver/state/route и не использовать устаревшую оценку.
7. Добавить unit tests на storage helper lifecycle и E2E на waiting/price backend readback, reload и error rollback; отдельно проверить две вкладки.
8. Сохранить customer price override как временный UI state, но подтверждать его по backend snapshot, а не только по resolve mutation Promise.

## 13. Источники в pinned main

- `taxi/src/tools/driverOffer.ts`: pickup ETA map/set/get около 236–317; choice maps и helpers около 331–505, 635–730, 808–880.
- `taxi/src/pages/Passenger/VotingForm.tsx`: waiting mutation около 846–887; rejected/confirmed cleanup около 1065–1125; customer price override около 1130–1158; choice state/event listeners около 440–511.
- `taxi/src/components/PassengerLiveOrder/index.tsx`: parallel selected-driver cancellation and rejected-choice flow.
- `taxi/src/components/MiniOrders/index.tsx`: active driver resolver около 262–290.
- `taxi/src/API/order.ts`: customer price mutation около 422–452; candidate select/release около 772–815; waiting mutation около 869–888.
- `taxi/src/appCache.ts`: startup removal keys около 28–54 и startup cleanup около 356–423.
