# 17. Passenger candidate selection — local fallback and state consistency

## 1. База и границы

Исходники проверены только на pinned `main` commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`. Документ добавлен в `audit/frontend-inventory`; application source не менялся. Анализ статический. Backend semantics выбора/снятия кандидата подтверждаются только ранее зафиксированными live-наблюдениями из stage 16 и не заменяют backend source review.

## 2. Краткий вывод

Local fallback не является просто «безопасным UI-кешем». При определённом отказе API он записывает локальное подтверждение и переключает пассажирскую форму в состояние выбранного водителя, хотя успешное серверное назначение не подтверждено.

Условия fallback слишком широкие: заказ должен быть choice order, в локальном rejected list должен быть хотя бы один водитель, а выбранный кандидат должен находиться в любом из состояний, считающихся видимыми для выбора: Considering, Performer, Arrived или Started. Не требуется успешный backend readback; helper не проверяет, что кандидат действительно назначен Performer.

Дополнительно обнаружено расхождение двух UI-компонентов: VotingForm трактует локально подтверждённого кандидата в состоянии Considering как выбранного водителя; PassengerLiveOrder при том же локальном подтверждении показывает selected driver только если backend-состояние уже Performer/Arrived/Started/Finished. Поэтому после fallback представление может зависеть от того, какой экран отображает заказ.

## 3. Путь выбора и retry

В `pages/Passenger/VotingForm.tsx` обработчик выбора:

1. Собирает release IDs из `getChoiceDriverIdsToReleaseBeforeChoosing` и локального rejected list, кроме нового кандидата.
2. Best-effort вызывает `releaseCandidate(orderId)`, затем release по каждому ID. Ошибки только логируются.
3. Вызывает `selectCandidate(orderId, nextCandidateId)`.
4. Только если ошибка распознана как blocked-selection, делает hard release: освобождает заказ и другие записи в Performer/Arrived/Started, ждёт 650 мс и повторяет select.
5. После успешного Promise записывает локальный confirmed choice, обновляет UI и refresh списка.
6. При любой окончательной ошибке проверяет local fallback; если helper разрешает, записывает локальный confirmed choice, пишет flow event `DriverSelectedLocalFallback`, обновляет UI и сворачивает форму без серверного подтверждения.

Та же схема fallback присутствует в `components/PassengerLiveOrder/index.tsx`. Значит это не единичный вспомогательный путь одного компонента.

Важно: release до выбора best-effort, но это не означает, что выбор после ошибки становится допустимым. Ошибка выбора может означать отказ сервера назначить кандидата, а не временную блокировку, которую можно безопасно компенсировать локальным состоянием.

## 4. Точные условия fallback

Обе реализации `canUseLocalChoiceFallback` имеют одинаковую логику:

- заказ существует и распознан как `isChoiceOrder`;
- `rejectedChoiceIds.length > 0`;
- кандидат с `u_id === nextCandidateId` присутствует в `order.drivers`;
- его `c_state` входит в `isVisibleChoiceDriverState`.

`isVisibleChoiceDriverState` включает Considering, Performer, Arrived и Started. Следовательно, fallback разрешён даже если кандидат лишь откликнулся/рассматривается и не является backend Performer. Также helper не классифицирует причину последнего отказа и не проверяет свежий snapshot после ошибки.

Наличие хотя бы одного ранее отклонённого водителя — единственный дополнительный признак, используемый как основание для локального fallback. Это косвенный признак повторного выбора, но не доказательство серверного назначения нового водителя.

## 5. Как local choice превращается в «выбранного водителя»

`setPassengerConfirmedChoice(orderId, userId)` записывает `orderId → userId` в localStorage, ставит локальный timestamp, очищает отметку перезапуска поиска и отправляет два browser custom events:
- `passengerConfirmedDriverChoice`;
- `driver-emulator-choice`.

Серверный запрос внутри этой функции отсутствует.

В `VotingForm.getSelectedDriver` локальный ID имеет приоритет: компонент возвращает запись с этим `u_id`, если её состояние просто не равно Canceled. Поэтому Considering, Performer, Arrived и Started становятся selected driver. Это directly влияет на карточку выбранного водителя, имя/автомобиль, статусную панель, телефонный вызов и возможность открыть cancel action (для Considering и Performer).

В `PassengerLiveOrder.getSelectedDriver` правило строже: локальный ID считается selected только при backend-состоянии Performer, Arrived, Started или Finished. Если такого состояния нет, компонент возвращает null для choice order и продолжает показывать подбор кандидатов. Таким образом, одинаковый localStorage state и одинаковый order snapshot могут приводить к разному UI в двух компонентах.

Ни один из этих UI-компонентов не делает backend назначение фактом только на основании localStorage для backend-команд. Однако сама карточка и пользовательское сообщение «водитель выбран» могут сформировать ложное ожидание. Реальная доступность дальнейших lifecycle-действий должна проверяться по конкретным обработчикам и серверной авторизации; этот аудит не утверждает, что локальный fallback сам по себе позволяет начать/завершить поездку.

## 6. LocalStorage: срок жизни и синхронизация

В `tools/driverOffer.ts` используются следующие ключи, индексированные по order ID:
- `passengerConfirmedDriverChoices`;
- `passengerConfirmedDriverChoiceStartedAt`;
- `passengerRejectedDriverChoices`;
- `passengerChoiceSearchRestartedAt`;
- также рядом используются ключи режима заказа и продления ожидания.

Особенности:
- confirmed/rejected данные не содержат user ID или tenant ID в ключе;
- для confirmed choice и rejected choices не обнаружен TTL/автоматическое удаление по возрасту;
- очистка confirmed choice удаляет запись только по order ID; rejected list имеет отдельный write path, а в рассмотренных обработчиках отмены выбранного водителя добавляется rejected ID, но не видно удаления всей истории отклонённых кандидатов;
- custom events синхронизируют слушателей в том же document; явного `storage` event listener для этих ключей в рассмотренных компонентах не обнаружено;
- localStorage не синхронизирует состояние между устройствами/браузерами; серверное readback остаётся единственным общим источником истины;
- `appCache.ts` включает перечисленные choice keys в `BOOT_LOCAL_REMOVE_EXACT`, а `resetStaleAppCache()` вызывает удаление exact keys на старте. Следовательно, данные локального выбора очищаются при следующем запуске приложения, а не являются надёжным долговременным состоянием. В рамках одной открытой сессии они могут сохраняться без TTL.

Отдельно: browser localStorage обычно доступен другим вкладкам того же origin, но приложение не использует стандартный storage event для согласования этих ключей. Поэтому параллельные вкладки могут иметь устаревшее React state даже при общей storage записи. Это статический вывод о найденных подписках, не runtime-воспроизведение гонки.

## 7. Candidate release selection helper

`getChoiceDriverIdsToReleaseBeforeChoosing(order, nextCandidateId)` возвращает:
- самого next candidate, только если его состояние Canceled;
- других водителей только если их состояние Performer.

Он не добавляет Arrived/Started. Расширенный hard-release список в обоих UI handlers добавляет Performer, Arrived и Started других водителей, но выполняется только после ошибки, распознанной как blocked-selection.

Это разумно как ограниченный retry для backend, который сохраняет старое назначение, но:
- best-effort ошибки release не блокируют select;
- распознавание blocked error основано на строках сообщения;
- нет readback между release и повторным select;
- если повторный select тоже падает, fallback всё ещё может локально подтвердить кандидата при наличии rejected history.

Ранее установленный live backend факт из stage 16 остаётся важным: release уже назначенного Performer может быть отклонён как `wrong booking state`. Поэтому release loop нельзя считать доказательством снятия предыдущего назначения.

## 8. Тестовое покрытие

В проверенных тестовых сценариях/документации есть happy-path интеграционные сценарии выбора:
- A.1.2 — voting;
- A.1.3 — offer;
- A.1.5 — выбор как предусловие последующей отмены.

По результатам поиска в pinned main не найден отдельный тест, который:
- заставляет первый и повторный `selectCandidate` завершиться ошибкой;
- проверяет истинность/ложность fallback для разных `c_state`;
- проверяет local fallback при Considering;
- сравнивает VotingForm и PassengerLiveOrder после одинакового local choice;
- проверяет повторную загрузку страницы, вторую вкладку или другой браузер;
- проверяет очистку choice storage на старте приложения.

Это означает test gap в проверенных файлах, а не доказательство отсутствия любых ручных проверок.

## 9. Новые замечания

| ID | Приоритет | Замечание | Основание |
|---|---|---|---|
| PASS-17-01 | High | Local fallback разрешён для Considering и не требует подтверждения backend Performer/readback | `canUseLocalChoiceFallback` + `isVisibleChoiceDriverState` |
| PASS-17-02 | High | VotingForm отображает local choice для любого non-Canceled состояния, PassengerLiveOrder требует Performer+ | Разные `getSelectedDriver` |
| PASS-17-03 | Medium | Choice state хранится локально по order ID без user/tenant scope и TTL; очищается startup cleanup, но может быть stale в течение сессии/между вкладками | `driverOffer.ts`, `appCache.ts` |
| PASS-17-04 | Medium | Release/retry best-effort; после повторного отказа local fallback всё ещё может скрыть неуспешное назначение | Оба candidate handlers |
| TEST-17-05 | Medium | Нет найденных тестов fallback state matrix, cross-component consistency и storage lifecycle | Проверенные тесты/поиск |

## 10. Рекомендации

1. Убрать local fallback как эквивалент успешного выбора. Если продукту нужен offline/temporary state, показывать отдельный статус «запрос выбора не подтверждён сервером», не карточку назначенного водителя.
2. Если fallback сохраняется, ограничить его явно определённой ошибкой временной недоступности и состоянием кандидата, подтверждённым backend readback. Не считать Considering назначением.
3. Сделать единую функцию разрешения selected driver для VotingForm и PassengerLiveOrder, основанную на backend state и одном согласованном контракте.
4. После успешного `selectCandidate` перечитать заказ и подтвердить, что выбранный user ID действительно Performer (или документированное эквивалентное состояние), прежде чем писать confirmed choice.
5. Разделить локальные UI hints и подтверждённое сервером назначение: разные поля/типы и разные тексты интерфейса.
6. Добавить тестовую матрицу состояний Considering/Performer/Arrived/Started/Canceled; тестировать blocked error, обычную business error, network error, неудачный повторный select и backend readback.
7. Пересмотреть startup cleanup и ключи: user/tenant scoping, понятный TTL/очистка по terminal order state, storage-event/refresh policy для нескольких вкладок. Не полагаться на localStorage как источник межустройственного состояния.

## 11. Источники в pinned main

- `taxi/src/pages/Passenger/VotingForm.tsx`: candidate handler около строк 895–1010; selected driver и fallback helpers около 2147–2193; selected driver panel около 1284–1375.
- `taxi/src/components/PassengerLiveOrder/index.tsx`: candidate handler около 371–464; selected driver resolver и fallback helper около 892–956; driver actions/boarding code около 694–780.
- `taxi/src/tools/driverOffer.ts`: storage keys/maps около 236–430; confirmed/rejected choice methods около 635–831; release helper около 893–912.
- `taxi/src/appCache.ts`: startup removal list около 28–54; `resetStaleAppCache` около 356–423.
- `taxi/src/API/order.ts`: `chooseCandidate` sends `set_performer=1`, rejects `status=error`, then writes local choice around 772–795; release sends `set_performer=0` around 797–815.
