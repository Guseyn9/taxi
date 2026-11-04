# 16. Passenger mutations — UI → Gateway → API → test coverage

## 1. База и ограничения

Исходный код проверен на pinned main 8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf. Анализ статический. Команды Jest/Playwright в этой сессии не запускались. Backend gruzvill не представлен исходниками в репозитории; endpoint semantics ниже отделены от фактов frontend.

## 2. Сводная карта

| Операция | UI entry point | Gateway/API | Найденное сквозное покрытие |
|---|---|---|---|
| Полная отмена заказа | VotingForm → CancelModal | ordersActionCreators.cancel → API.cancelDrive → set_cancel_state | TEST-E2E-006, TEST-E2E-007 |
| Выбор кандидата / принять оффер | VotingForm candidate select | passengerGateway.selectCandidate → chooseCandidate → set_performer=1 | A.1.2 voting, A.1.3 offer; также A.1.5 как предусловие |
| Снять выбранного водителя | inline Cancel → DriverChoiceCancelReasonModal | passengerGateway.releaseCandidate → releaseCandidateChoice → set_performer=0 | отдельного E2E на этот click path не найдено |
| Изменить время поиска | VotingForm extension | passengerGateway.updateWaitingTime → setWaitingTime → set_waiting_time | отдельного E2E на действие и readback не найдено |
| Повысить цену заказчика | PriceInput commit | passengerGateway.updateCustomerPrice → updateOrderCustomerPrice → action=edit | отдельного E2E на действие и readback не найдено |
| Автоматическая отмена истёкшего выбора | VotingForm lifecycle handler | passengerGateway.cancelOrder либо onLockedCancel | не считать заменой тесту ручной отмены; отдельный сценарий истечения требует проверки |

## 3. Полная отмена заказа — покрыта хорошо

Основная кнопка Cancel открывает CancelModal. Подтверждение вызывает Redux action cancel с выбранной причиной. CancelModal:
- блокирует повторный submit через isSubmitting;
- ждёт Promise;
- при успехе обновляет active orders, сбрасывает selectedOrder и закрывает модалку;
- при ошибке показывает MessageModal с общей ошибкой;
- при закрытии по overlay отдельного запрета на закрытие во время запроса нет (onClick напрямую закрывает modal).

API.cancelDrive отправляет action=set_cancel_state и reason на /drive/get/{id}.

TEST-E2E-006 (offer-passenger-cancel.spec.ts) проходит отмену уже назначенного заказа через реальный UI пассажира. Проверяются backend b_state=Canceled, active=false, неизменность записи performer/c_state (наблюдаемый контракт), исчезновение карточки, уведомление водителя, отсутствие действий и persistence после reload. TEST-E2E-007 отдельно проверяет SOS-сценарий после Started. Это не следует путать с inline release candidate.

## 4. Выбор кандидата / принятие оффера — покрытие есть, но есть сложная стратегия retry

### 4.1 Реальный путь

Кнопка выбора кандидата в VotingForm вызывает handleChooseCandidate. Путь:
- passengerGateway.selectCandidate(orderId, userId);
- LegacyPassengerGateway dispatches PASSENGER_ACTIONS.SelectCandidate;
- handler вызывает backendGateway.chooseCandidate;
- API.chooseCandidate проверяет наличие текущего userId и отправляет action=set_performer, performer=1, u_id=выбранного кандидата;
- API отклоняет тело ответа с status=error.

Перед выбором новый UI-handler пытается выполнить releaseCandidate:
1. release без user id;
2. release каждого id из computed releaseIds;
3. selectCandidate;
4. если select отклонён как blocked, повторно выполняет release без id и release по hardReleaseIds;
5. ждёт 650 ms и повторяет select.

Ошибки предварительного release логируются, но не прерывают основной выбор. Это осознанная best-effort стратегия совместимости с backend, но она означает, что корректность перехода зависит от итогового backend readback, а не от успешности каждого release.

### 4.2 Локальный fallback

Если selectCandidate завершается ошибкой, код проверяет canUseLocalChoiceFallback. При выполнении условий он записывает подтверждённый выбор локально, пишет flow event DriverSelectedLocalFallback, обновляет список и сворачивает форму — без доказанного успешного backend назначения.

Это потенциально опасная граница согласованности: пассажирский интерфейс может показать выбранного водителя на основании local fallback, хотя backend назначение могло не состояться. Нужны точные условия helper и backend readback в тесте, прежде чем считать такой fallback допустимым. Само наличие ветки подтверждено кодом; фактический пользовательский инцидент не установлен.

### 4.3 Покрытие

- A.1.2 проверяет голосование: водитель-кандидат, пассажир выбирает его, backend performer state и пассажирский UI согласованы.
- A.1.3 проверяет два независимых предложения водителей, их цены, выбор пассажиром одного и то, что второй не становится performer.
- A.1.5 использует выбор водителя как предусловие для проверки отмены.

Это сильное покрытие основного happy path, но оно не гарантирует тестирование всех ветвей release/retry/local fallback.

## 5. Снятие выбранного водителя — отдельный риск

Inline Cancel у карточки назначенного водителя не отменяет весь заказ. Он открывает DriverChoiceCancelReasonModal, затем handleConfirmCancelSelectedDriver:
- сначала вызывает releaseCandidate(orderId, driverId);
- при ошибке повторяет releaseCandidate(orderId) без driver id;
- если оба вызова не удались — показывает общую ошибку;
- при успехе добавляет водителя в локальный rejected list, сбрасывает confirmed choice, перезапускает поиск и раскрывает форму.

Для перехода с Considering на нового кандидата есть и отдельный путь предварительного release в handleChooseCandidate.

В e2e/README.md задокументирован замер live backend: release через set_performer&performer=0 отклоняется с wrong booking state для уже назначенного Performer. Поэтому inline Cancel после назначения не эквивалентен полной отмене и не гарантирует возможность вернуть заказ в поиск. В README сказано, что release рабочий до назначения (Considering), но отдельный тест реального UI снятия кандидата в найденном E2E наборе не обнаружен.

**Риск:** продуктовый текст кнопки и причина в модалке могут создавать ожидание, что можно отказаться от назначенного водителя и выбрать другого. Backend может не разрешать такой переход после Performer. Нужно определить поддерживаемые состояния и не показывать/не обещать действие, если сервер его отвергает.

## 6. Изменение времени ожидания — API есть, сквозной тест не найден

В VotingForm есть handleExtendLockedWaiting:
- вычисляет previousWaitingTime как исходное максимальное ожидание + локально учтённые добавления;
- передаёт additionalTime из getChoiceWaitingIntervalSeconds();
- при успехе увеличивает локальный счётчик, показывает краткую индикацию успеха и обновляет active orders;
- при ошибке показывает общую MessageModal;
- блокирует повторное нажатие через extendingLockedWaiting.

API.setWaitingTime отправляет action=set_waiting_time, previous и additional. Обёртка возвращает res.data без явной проверки res.status === 'error'. Поэтому бизнес-ошибка backend, возвращённая HTTP 200 с status=error, потенциально может трактоваться UI как успех, если endpoint использует такой формат. Это гипотеза по отсутствию проверки в wrapper, не подтверждённый ответ конкретного backend вызова.

В старом VoteModal ошибка лишь console.error; активный путь зависит от того, какой UI entry point реально смонтирован. PassengerLiveOrder имеет свой путь, но ранее проверено, что showLiveOrderPanel=false в Passenger/index.tsx; не считать его активной точкой без нового подтверждения.

**Нужно:** тестировать фактический активный VotingForm path, HTTP/business error, повторный запрос, backend readback b_max_waiting/соответствующего поля и корректное восстановление UI после reload.

## 7. Повышение цены заказчика — optimistic update с rollback, тест не найден

handleLockedCustomerPriceCommit:
- округляет значение до целого и ограничивает снизу текущей lockedCustomerPrice;
- не разрешает уменьшение, изменение при выбранном водителе или повторное сохранение;
- до ответа API оптимистично записывает override и обновляет PriceInput;
- вызывает passengerGateway.updateCustomerPrice(lockedOrder, safeValue);
- при успехе обновляет active orders;
- при ошибке сбрасывает override и восстанавливает прежнюю цену, показывает submitError и обновляет active orders.

API.updateOrderCustomerPrice создаёт копию заказа, записывает customer_price в b_options, reverse-convert, формирует набор CUSTOMER_PRICE_EDIT_KEYS и отправляет action=edit с JSON data. В отличие от setWaitingTime, wrapper явно отклоняет ответ status=error.

Потенциальные вопросы:
- редактируется не отдельное поле, а JSON-пакет из разрешённого набора ключей; backend может валидировать или отклонять часть полей;
- текущий клиентский код запрещает уменьшение цены (safeValue <= floorValue), но frontend не является серверной бизнес-валидацией;
- нет найденного E2E, который доказывает сохранение новой цены на backend и rollback при отказе.

## 8. Новые замечания аудита

| ID | Приоритет | Замечание | Статус |
|---|---|---|---|
| PASS-16-01 | High | Local choice fallback способен отобразить выбранного водителя без подтверждённого backend назначения | Требуется аудит условий fallback и тест readback |
| PASS-16-02 | High | Inline release для уже назначенного Performer не поддержан измеренным backend контрактом; UI действие не имеет найденного отдельного E2E | Ограничение backend подтверждено документацией live-замера; пользовательский путь не протестирован |
| PASS-16-03 | Medium | setWaitingTime не проверяет status=error в HTTP-200 response, в отличие от chooseCandidate/updateCustomerPrice | Потенциальная ошибка обработки бизнес-ошибки |
| TEST-16-04 | Medium | Нет найденного E2E для продления ожидания с backend readback | Test gap |
| TEST-16-05 | Medium | Нет найденного E2E для изменения customer_price и rollback при отказе | Test gap |
| TEST-16-06 | Medium | Нет найденного отдельного E2E для inline release candidate до Performer | Test gap |

## 9. Приоритетные действия

1. Разобрать canUseLocalChoiceFallback и getChoiceDriverIdsToReleaseBeforeChoosing; установить точные состояния, при которых UI вправе подтверждать выбор локально.
2. На staging проверить releaseCandidate в состояниях Considering, Performer, Arrived и Started; зафиксировать backend матрицу переходов. Скрывать/отключать inline release там, где backend не поддерживает действие.
3. Исправить/покрыть setWaitingTime: трактовать status=error как reject и проверить поведение при ошибке.
4. Добавить E2E изменения customer_price: запрос, backend readback, отображение после reload, rollback на business error.
5. Добавить E2E продления ожидания: проверить exact previous/additional payload и сохранённое значение backend.
6. Сохранять существующие A.1.2/A.1.3/A.1.5 как позитивные интеграционные тесты выбора и отмены; они не заменяют тесты негативных/повторных ветвей.

## 10. Границы утверждений

- Backend semantics release candidate после Performer опирается на замер, описанный в e2e/README.md; backend source code отсутствует.
- Отсутствие теста означает, что он не найден в проверенных e2e/unit файлах и документации, а не абсолютное доказательство отсутствия ручной проверки.
- Ни один из описанных тестов не запускался в этой сессии.
