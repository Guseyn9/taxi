# 15. Passenger Chat / SOS / Rating — фактическое тестовое покрытие

## 1. База и метод

Проверен код только на pinned main 8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf. Сверены E2E spec, E2E README, unit test и API adapter. Это аудит существующих тестовых артефактов и описанных прогонов; тесты в этой сессии не запускались.

## 2. SOS — сильное сквозное покрытие

### 2.1 E2E TEST-E2E-007

Файл: taxi/e2e/passenger-sos.spec.ts.

Основной сценарий:
- отдельные browser contexts пассажира и водителя;
- fixture заказа создаётся API, затем дальнейшие бизнес-переходы выполняются UI обеих ролей;
- водитель принимает заказ, пассажир выбирает его, водитель проходит Arrived и Started через UI;
- перед SOS проверяется backend entry condition: заказ Approved, водитель Started, заказ active;
- пассажир нажимает реальную кнопку SOS, выбирает причину и подтверждает;
- тест перехватывает реальный запрос из браузера пассажира и ответ backend;
- проверяет один запрос, action, reason, HTTP 200 и бизнес-ответ code=200 без status=error;
- повторным чтением проверяет b_state=Canceled, active=false, b_cancel_reason равен выбранной причине;
- проверяет исчезновение заказа из UI, сохранение после reload и блокирование продолжения у водителя.

Отдельный тест проверяет, что Driver Alarm остаётся отдельным AlarmModal, а Passenger SOS не появляется у водителя.

### 2.2 Unit

src/tools/__tests__/passengerSos.test.js покрывает:
- трактовку бизнес-ошибки backend, включая HTTP-200-совместимый ответ status=error;
- отказ при пустом/неожиданном ответе;
- передачу выбранной причины ровно один раз;
- проброс сетевой ошибки и возможность повторной отправки;
- Redux reducer и маршрутизацию Passenger SOS vs Driver Alarm.

Часть тестов маршрутизации — source-text assertions, а не React interaction test. Они полезны как регрессионный барьер, но не заменяют браузерную проверку.

### 2.3 Исторический прогон

В e2e/README.md задокументирован зелёный CI run 37657829329 от 2026-10-07: 14/14 тестов A.1.1–A.1.6 на commit aebcd3c. Также описаны три последовательных локальных изолированных прогона SOS 2026-10-05.

Это исторические свидетельства из документации репозитория, а не новый прогон на pinned main в рамках текущего аудита. Повторный CI на текущем baseline не запускался.

**Оценка:** SOS UI → backend cancellation contract → backend readback имеет наиболее полное покрытие из трёх функций.

## 3. Chat — тестовый пробел

Найденный Chat implementation:
- кнопка ChatToggler переключает Redux activeChat;
- Chat открывает сессию через LegacyChatGateway;
- gateway использует ReconnectingWebSocketClient и URL wss://chat.itest24.com:7007;
- протокол отправляет action=start, исходящее сообщение — action=send.

В проверенных E2E и unit наборах не обнаружен тест, который проходит полный путь:
1. клик по ChatToggler;
2. WebSocket open и start payload;
3. получение/отображение входящего сообщения;
4. отправка сообщения и проверка send payload;
5. close, reconnect и ошибка соединения.

Не найден и тест, подтверждающий delivery или сохранение сообщения на chat service.

**Оценка:** статический путь понятен, но автоматизированное подтверждение realtime поведения не установлено. Отсутствие найденного теста не доказывает, что ручной тест никогда не проводился.

## 4. Rating — тестовый пробел и узкий API payload

### 4.1 Реальный API contract из frontend

src/API/order.ts, _setOrderRating:
- принимает order id и числовой value;
- добавляет action = EBookingActions.SetRate;
- добавляет value;
- отправляет POST на /drive/get/{id}.

Вызов RatingModal передаёт только (_orderID, stars). Следовательно, текущий frontend API wrapper поддерживает только числовую оценку. Tips/comment не входят в его сигнатуру или formData.

Это подтверждает frontend payload, но не описывает неизвестные дополнительные возможности backend.

### 4.2 Тесты

В найденных тестах нет отдельного RatingModal.test, API payload test для setOrderRating или Playwright сценария:
- открыть рейтинг;
- заполнить stars/tips/comment;
- отправить;
- проверить запрос;
- проверить backend readback;
- проверить ошибку и повторную отправку.

В E2E README в перечне сценариев A.1.1–A.1.6 рейтинг не заявлен как отдельный end-to-end сценарий. Поиск по тестовым исходникам не выявил другого выделенного rating E2E.

### 4.3 Риск

Из исходников подтверждено:
- tips/comment вводятся, но не отправляются;
- modal закрывается сразу после запуска Promise;
- ошибка API только логируется/пишется flow event, без видимого пользователю восстановления.

**Оценка:** Rating UI и API wrapper имеют существенно меньшую тестовую защиту, чем SOS.

## 5. Сводная матрица покрытия

| Функция / гарантия | Unit | Browser UI | Реальный backend / readback | Оценка |
|---|---|---|---|---|
| SOS: выбор причины и UI state | Да, часть source assertions | Да | — | Хорошо |
| SOS: один запрос и reason | Helper unit | Да | Да, readback причины | Хорошо |
| SOS: отказ при business error | Helper unit | Не воспроизводится безопасно в live | Нет для error branch | Частично |
| SOS: после reload и запрет продолжения | — | Да | Да | Хорошо |
| Chat: open/start/send/incoming | Не найдено | Не найдено | Не найдено | GAP |
| Chat: reconnect/error/delivery | Не найдено | Не найдено | Не найдено | GAP |
| Rating: stars payload | Не найдено отдельного API test | Не найдено | Не найдено | GAP |
| Rating: tips/comment persistence | Не найдено | Не найдено | Не найдено | GAP; текущий UI не отправляет |
| Rating: API failure / retry | Не найдено | Не найдено | Не найдено | GAP |

## 6. Реестр новых замечаний

| ID | Приоритет | Замечание | Статус |
|---|---|---|---|
| TEST-15-01 | Medium | Chat не имеет обнаруженного E2E покрытия WebSocket жизненного цикла | Test gap |
| TEST-15-02 | High | Rating не имеет обнаруженного E2E/API payload покрытия; пользовательские поля не проверяются | Test gap |
| TEST-15-03 | Medium | SOS business-error branch покрыт helper unit, но не browser-to-backend negative scenario | Known limitation; безопасный live test отсутствует |

## 7. Практический план закрытия

### Chat
1. Unit для LegacyChatGateway с mock WebSocket: URL, start, send, close.
2. Component test для ChatToggler → activeChat → Chat.
3. Browser E2E с локальным WebSocket test server: входящее/исходящее сообщение, reconnect, close, error.
4. Отдельный staging integration check для auth, delivery и persistence.

### Rating
1. Зафиксировать продуктовый контракт: только stars или stars + tips + comment.
2. API unit test проверяет multipart action и value.
3. Исправить UI: не закрывать modal до success; при failure сохранять введённое и показывать retry.
4. Добавить E2E и backend readback для stars и, если предусмотрены, tips/comment.
5. Проверить повторное открытие рейтинга после завершения заказа и защиту от duplicate submit.

### SOS
1. Сохранить существующий сильный E2E.
2. Добавить browser-level test для backend business error на контролируемом staging/mock endpoint, не отменяя чужой или реальный заказ.
3. Явно документировать продуктовый смысл: это пользовательский сценарий отмены с причиной, а не доказательство вызова экстренных служб.

## 8. Ограничения аудита

- Не запускались npm/Jest/Playwright команды в текущей сессии.
- CI run 37657829329 взят из e2e/README.md; его артефакты и соответствие текущему pinned main здесь заново не скачивались.
- Backend исходники отсутствуют в рассматриваемом frontend repository.
- «Тест не найден» означает отсутствие в проверенном наборе файлов/поисковых результатов, а не абсолютное доказательство отсутствия ручной проверки или внешнего тестового проекта.
