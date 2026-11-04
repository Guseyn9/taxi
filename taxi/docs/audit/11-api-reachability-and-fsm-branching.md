# 11. Продолжение API-аудита: проверка реальной достижимости и ветвления FSM

## 1. База и правило

Проверен только исходный код commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf` (main baseline). Отдельная локальная QA-версия считается отсутствующей и не используется для выводов. Ветка `review/10-qa-review` исключена.

Цель этапа — уточнить, какие ранее найденные API-риски реально достижимы из UI, и не объявлять неиспользуемый метод production-дефектом без доказательства вызова.

## 2. Boarding: два разных пути исполнения

### 2.1 Фактический код

В `src/API/order.ts`:

- `arrivedVotingOrder(id)` — async stub, возвращает `{code:'200', data:{id}}`, без HTTP.
- `confirmVotingCode(id, code)` — async stub, возвращает `{code:'200', data:{id,code}}`, без HTTP.
- `setOrderState(id, Started, driverCode)` — реальный POST на `/drive/get/{id}` с action `set_start_state` и полем `b_driver_code`, если код передан.

В `src/platform/adapters/DriverMapGateway.ts`:

- Если `commandTransport` настроен и действие является lifecycle action (Arrive/Start/ConfirmBoarding/Finish/Cancel), шлюз отправляет FSM command и ожидает completion.
- Если command transport не настроен, используется legacy switch:
  - Arrive: реальный `setOrderState(Arrived)`; для voting дополнительно вызывается stub `arrivedVotingOrder`.
  - ConfirmBoarding: вызывается stub `confirmVotingCode`, затем реальный `setOrderState(Started, boardingCode)`.
  - Start: реальный `setOrderState(Started)`.

Следовательно, результат зависит от runtime-конфигурации. Нельзя утверждать, что stub вызывается во всех deployment builds: в FSM lifecycle path он обходится. Но в legacy fallback path он достижим.

### 2.2 Что это означает для PIN

На выбранном main фронтенд не получает серверное подтверждение кода от `confirmVotingCode`: эта функция всегда возвращает синтетический успех. Затем legacy path передаёт код в `set_start_state`. Отдельная live backend проверка, описанная в stage 09, установила, что well-formed неверный PIN был принят backend и состояние изменилось.

Это усиливает вывод: PIN нельзя считать подтверждением личности в legacy path. В FSM path результат зависит от серверной реализации intent `driver.order.confirm_boarding`; его проверка на целевом FSM backend не предъявлена. До подтверждения server-side enforcement обоих путей boarding PIN — пилотный gate.

### 2.3 Тесты не доказывают серверную проверку

Тесты `DriverMapGateway.test.js`, `DriverBoardingCommandPath.test.js` и `DriverBoardingProjection.test.js` подменяют `backendGateway.confirmVotingCode` mock-функцией. Они проверяют порядок вызовов, UI-события и обработку mock-ошибки. Они не проверяют реальный backend PIN validator. E2E TEST-E2E-009 не заменяет negative test на заведомо неверный, но корректно сформированный PIN.

**Статус:** frontend orchestration частично покрыта unit tests; серверная проверка PIN не подтверждена, live legacy observation отрицательная.

## 3. Voting arrival stub: уточнение области воздействия

Поиск всех ссылок на `arrivedVotingOrder` в выбранном commit показал:
- экспорт из `src/API/order.ts` и re-export из `src/API/index.ts`;
- регистрацию метода в `LegacyBackendGateway`;
- вызов из legacy ветки `DriverMapGateway.handleAction(Arrive)`, только когда `payload.voting` true;
- тест `DriverMapGateway.test.js` проверяет вызов mock.

Это не универсальное подтверждение прибытия. В legacy path реальный переход Arrived уже отправлен через `setOrderState`; последующий voting stub не подтверждает дополнительное действие на сервере. Если backend ожидает дополнительную voting-specific операцию, она не выполняется. Если не ожидает — stub является misleading dead integration. Требуется согласовать бизнес-контракт голосования.

## 4. notifyPosition: не подтверждена достижимость из приложения

`src/API/index.ts` содержит `notifyPosition(point)`, отправляющий координаты и user ID по plain HTTP на `jecat.ru/car_api/api/notifypos.php`.

Поиск по выбранному commit нашёл определение функции, но не нашёл call site в приложении или Gateway. Поэтому предыдущая формулировка «если используется с реальными координатами — блокер» остаётся условной; **фактический вызов из пользовательского потока не установлен**.

Итог:
- транспорт и состав отправляемых данных — подтверждены в source;
- достижимость в штатном UI — не подтверждена;
- пункт не следует считать доказанным production data leak без runtime/network evidence;
- рекомендуется удалить мёртвый метод, если внешний потребитель не существует, либо документировать владельца и назначение, если вызов делается вне SPA.

## 5. getTrips / getWashTrips: уточнение

- `getTrips(type)` принимает `type`, но не использует его в URL или FormData. Поиск не обнаружил call site в текущем приложении. Риск влияния на пользовательский поток не подтверждён; метод выглядит неиспользуемым в доступном source graph.
- `getWashTrips(type)` также не использует `type`. Единственный найденный UI call site — `src/components/Map/index.tsx`, вызов `backendGateway.getWashTrips()` без аргумента. Следовательно, неиспользуемый параметр не меняет текущий вызов. Сам endpoint `/trip/get` достижим при открытии соответствующего Map UI; контракт/авторизация endpoint должны быть проверены отдельно.

## 6. Корректировки статусов предыдущего API-реестра

| Finding | Предыдущая формулировка | Уточнённый вывод на main |
|---|---|---|
| API-03 | Voting arrival/code confirmation stubs; потенциально high | Подтверждено, что оба метода — синтетические stubs. Они достижимы в legacy fallback; FSM lifecycle path обходит их. PIN gate остаётся критическим, voting-specific дополнительная операция требует backend contract. |
| API-04 | Plain HTTP position endpoint; high if called | Определение метода подтверждено, но call site не найден. Не заявлять как подтверждённую утечку координат из пользовательского потока. |
| API-06 | Trip type parameters ignored | `getTrips` не имеет найденного call site; `getWashTrips` вызывается без type. Это не доказывает текущую ошибку пользовательского потока. |

## 7. Следующие проверки

1. Получить backend/FSM contract для intent `driver.order.confirm_boarding` и проверить серверный отказ на неверный PIN.
2. Запустить negative acceptance test на целевом tenant: неверный PIN той же длины, прямой Started без PIN, повтор команды и параллельные запросы.
3. Уточнить, должна ли voting arrival иметь отдельную серверную операцию сверх `set_arrive_state`; удалить stub или реализовать реальный контракт.
4. Подтвердить, что `notifyPosition` не вызывается внешним injected code; если нет — удалить неиспользуемый endpoint.
5. Удалить неиспользуемый параметр `type` у trip methods или реализовать фильтрацию только после согласования backend contract.

## 8. Вывод

Аудит main продолжается без QA-сборки. Важное уточнение — не все подозрительные API методы одинаково опасны: два voting/boarding stub метода действительно достижимы через legacy lifecycle fallback, тогда как plain HTTP `notifyPosition` пока не имеет обнаруженного call site. Для boarding PIN есть отрицательное live backend свидетельство на legacy endpoint; FSM endpoint требует отдельного теста. Никакой локальный QA статус не используется как подтверждение исправления.
