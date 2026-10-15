# TEST-E2E-009 — разведка этапа 1

> Дата: 2026-10-11. Ветка: `e2e_taxi_standard_driver_flow` от `origin/main` (`d6ee640`, merge PR #25).
> Документ описывает **разведку**, а не реализованный тест. Код теста не написан, production-логика не менялась.

## 0. Итог этапа 1 и что в нём НЕ подтверждено

**Условие завершения этапа 1 из ТЗ выполнено не полностью.**

| Что | Статус |
|---|---|
| Репозиторий, PR #25, дубль покрытия, инфраструктура | проверено |
| Карта сценария «UI → запрос → backend → UI» по исходникам | составлена, каждый переход размечен (§3) |
| Способы авторизации, наблюдения, независимого чтения и очистки | определены по существующим фикстурам (§5) |
| Baseline: `jest`, `tsc --noEmit`, `playwright --list` | зелёный (§8) |
| **Live-проверка до `Performer`** (форма → карточка водителя по `b_id` → принятие → панель пассажира → отмена по `b_id`) | **выполнена один раз** (2026-10-13, заказ `17418`, §7.2) |
| **Live-проверка `Arrived` / `Started`** | **НЕ выполнена** — по решению пользователя заказ дальше `Performer` не доводился |

**Решение по объёму probe (пользователь): вариант 2 — ограниченный probe только до `Performer`.** `Arrived`/`Started` не вызывались.

**Условие запуска нарушено осознанно, по прямому требованию пользователя.** Первоначально пользователь требовал запускать probe только при стабильном backend. Сеть так и не стала стабильной (§7.1; перед запуском раунды 6–9 из 10, полных ни одного), но пользователь дважды потребовал запуск «сейчас», и probe выполнен при этих условиях с усиленной очисткой (до 10 попыток отмены с независимым чтением состояния между ними). Результат одного прогона не доказывает стабильность тестового окружения.

Создан и отменён ровно один заказ: `17418` (§7.2).

### Обозначения способа подтверждения

* **SRC** — прочитано в исходниках приложения / фикстур в этом этапе (ссылка `файл:строка`).
* **README** — замер прежнего этапа из `e2e/README.md` (live, другой заказ/тест). **В этом этапе не перепроверялся**, поэтому на карту 009 он не переносится как факт.
* **LIVE** — наблюдение probe этого этапа (2026-10-13, заказ `17418`, **один прогон**). Только то, что probe фактически измерил; `Arrived`/`Started` не измерялись ни разу.

## 1. Репозиторий

* `origin/main` = `d6ee640` (`Merge pull request #25 … e2e_taxi_passenger_order_creation`). PR #25 (TEST-E2E-008) уже влит, зависимости от недоступных файлов нет. Голова PR #25 (`bfe02ee`) = прежний HEAD рабочей копии.
* Локальный `main` отставал (`827d9f8`); ветка создана от `origin/main` после `git fetch`. Целевой ветки до этого не было ни локально, ни на origin.
* У ветки специально снят upstream (`git branch --unset-upstream`): `switch -c … origin/main` выставляет трекинг на `main`, и случайный `git push` пошёл бы в `main`.
* Untracked-файлы пользователя не тронуты и в коммит не включаются: `README_EMULATOR_PROJECT_RU.txt`, `playwright-logs.txt`, `tasks/`, `taxi/DECISION_LOG_SPEC_RU.md`, `taxi/DRIVER_ROUTE_EMULATOR_STATUS.md`, `test-results/`. Добавлять в коммит только по явным путям, не `git add -A`.

## 2. Дубль покрытия: нет

| Spec | Создание заказа | Водитель через UI | Один `b_id` от формы до водителя |
|---|---|---|---|
| `standard-order.spec.ts` (002) | **API** `createStandardOrder` | да | нет |
| `voting-order` / `offer-*` (003–006) | API | да | нет |
| `passenger-sos.spec.ts` (007) | API | да | нет |
| `driver-boarding.spec.ts` (001) | API | да | нет |
| `passenger-order-creation.spec.ts` (008) | **форма пассажира** | **нет** (README 008: «Не входит: ответ водителя, Arrived/Started») | нет |

Связка «форма пассажира → карточка водителя с тем же `b_id` → принятие → Arrived → Started» не покрыта ни одним тестом. Способ: SRC (grep по `create*Order`, `watchOrderCreationRequest`, `takeOrderButton` по всем `*.spec.ts`).

## 3. Карта сценария

Колонка «Подтверждение» — по правилам из §0. Все transitions Standard-заказа.

### 3.1. Создание заказа пассажиром

| # | Действие UI | Элемент | Запрос | Ожидаемое состояние backend | Отображение | Подтверждение |
|---|---|---|---|---|---|---|
| 1 | Ввод адресов, выбор подсказки `official` | `passenger-order-from` / `-to`; `passenger-order-{from,to}-suggestion[data-suggestion-source=official]` | внешний геокодер (`getPointSuggestions`, debounce 500 мс) | — | значение в input | SRC `LocationInput/index.tsx`, `Input/index.tsx` |
| 2 | Контакт | `passenger-order-phone` (виден только при `expanded`; раскрытие формы — только touch-свайп) | — | — | — | SRC `VotingForm.tsx:1759-1766`; README 008 |
| 3 | Клик «Standard» (отдельной кнопки «Создать» нет) | `passenger-order-mode-order` (`VotingForm.tsx:1261`) | `POST {API}/drive`, multipart, поле `data` JSON с `b_start_latitude`; ответ `{status:'success', data:{b_id}}` | заказ существует по `b_id`; Standard: без `b_voting`, без услуги `5`; `b_location_class=1`; `b_car_class=50` | `passenger-mini-order[data-order-id=<b_id>]`, `passenger-order-form[data-locked="true"]` | SRC (`submit` `VotingForm.tsx:256-403`, `API/order.ts`, `passengerUi.ts:483-497`). **LIVE**: один создающий запрос, HTTP 200 `status=success`, `b_id=17418` за 403 мс; в payload `b_car_class="50"`, `b_location_class="1"`, нет `b_voting`/`b_services`/`b_cars_count`/`b_custom_comment`. Backend после создания: `b_state=1`, `b_voting` и `b_services` пусты, `b_cars_count="1"`, `b_custom_comment=""`, `drivers=[]`. В UI пассажира — `passenger-mini-order` с этим `b_id` и `data-locked="true"` |

### 3.2. Получение и принятие заказа водителем

| # | Действие UI | Элемент | Запрос | Ожидаемое состояние backend | Отображение | Подтверждение |
|---|---|---|---|---|---|---|
| 4 | Водитель открывает `/driver-order?tab=detailed&driverEmulator=1` | `driver-order-card[data-order-id=<b_id>]` (`OrderCard.tsx:303`) | polling `POST /drive/now` каждые 3 с (`READY_ORDERS_POLL_INTERVAL`, `state/orders/sagas.ts`); WebSocket нет | заказ в «готовых» водителя | карточка именно с этим `b_id` | SRC. **LIVE**: карточка `driver-order-card[data-order-id=17418]` у водителя `871` появилась через ≈3,0 с после создания (одно измерение); в списке было 2 карточки, то есть рядом лежит чужой заказ — выбирать только по `b_id` |
| 5 | Клик по карточке → «Взять заказ» | `driver-order-card` → `driver-order-take` (`CardModal.tsx:1904`) | `POST /drive/get/{b_id}`, `action=set_performer`, `performer=1`, `data={c_id,c_payment_way,…}` (`API/order.ts:529-534`) | `c_state=3` (Performer) у `driver.userId`; других исполнителей нет | пассажир: `passenger-driver-panel[data-driver-state="3"][data-driver-id=<driver>]` (`VotingForm.tsx:1295-1300`); заказ у пассажира выбирается автоматически после создания (`Passenger/index.tsx:160-174`) | SRC. **LIVE**: кнопка «Take order» (английская подпись) → `set_performer`, `performer=1`. Браузер отправил **два** запроса: первый получил `HTTP 200`, тело `status=error code=404` (приложение сначала передаёт `b_driver_code`, backend отклоняет — `API/order.ts:539-559`), второй — `status=success code=200`. Затем backend: `b_state=2`, `drivers=[{871: c_state 3}]`, то есть Performer сразу, без выбора пассажиром. Панель пассажира: `data-driver-state=3`, `data-driver-id=871` = ожидаемый водитель (показана после `selectPassengerOrder`; **автовыбор без клика отдельно не измерялся**) |

### 3.3. Переходы поездки (каждый отдельно)

> **LIVE по этому разделу: ничего.** `Arrived`/`Started` probe не вызывал. Всё ниже — SRC (и README для значений состояний).

Номера состояний: `EBookingDriverState` Considering=1, Canceled=2, **Performer=3, Arrived=4, Started=5**, Finished=6 (`src/types/types.ts:81-88`) — SRC. Что live-backend возвращает именно эти значения для Standard — README 002 (`DRIVER_STATE` в `taxiApi.ts`), **в этом этапе не перепроверялось**.

| Переход | Подпись кнопки (ключ перевода) | Обработчик | Endpoint и action | `c_state` после | Гейт | Подтверждение |
|---|---|---|---|---|---|---|
| **Performer → Arrived** | «Поехал» (`TRANSLATION.WENT`, `Map.tsx:1903`) | `onMapArrivedClick` (`Map.tsx:1804`) → `driverMapGateway.arrive` → `backendGateway.setOrderState(id, Arrived)` | `POST /drive/get/{b_id}`, `action=set_arrive_state` (`API/order.ts:825-827`) | **4** | нет | SRC. Локализованная строка живьём не наблюдалась (приходит из конфигурации backend), опираться на неё нельзя |
| **Arrived → Started** | «Приехал» (`TRANSLATION.ARRIVED`, `Map.tsx:1915`; у voting вместо него код посадки) | `onMapStartedClick` (`Map.tsx:1816`) → `driverMapGateway.start` → `setOrderState(id, Started)`; для Standard `b_driver_code` не передаётся (`API/order.ts:840-842`) | `POST /drive/get/{b_id}`, `action=set_start_state` | **5** | `requiresPickupArrival`: водитель ≤100 м от точки посадки (`PICKUP_ARRIVAL_RADIUS_METERS=100`, `tools/driverPosition.ts:24`; `Map.tsx:2495-2496, 3125`). Позиция — `c_latitude/c_longitude` водителя с backend, иначе GPS браузера (`Map.tsx:1660`) | SRC |

Подтверждение каждого перехода в UI: на карте — `driver-map-primary-action[data-driver-state][data-order-id]` (`Map.tsx:3113-3115`); у пассажира — `passenger-driver-panel[data-driver-state]`.

> **Оговорка, важная для теста.** `data-driver-state` на карте водителя берёт `effectiveDriverState` — это **оптимистичное** состояние, которое выставляется в момент клика (`rememberOptimisticState`, `Map.tsx:1808, 1825, 1594-1596`) и лишь потом заменяется опросом backend. Значит, одного совпадения атрибута водителя недостаточно: backend читается независимо и **до** вывода о состоянии. Панель пассажира берёт состояние из опрашиваемых данных заказа, оптимистичного слоя там нет.

### 3.4. Дальше по жизненному циклу — вне объёма

Finished (`set_complete_state`) требует позиции водителя ≤100 м от точки назначения (`DESTINATION_ARRIVAL_RADIUS_METERS`), иначе та же кнопка становится «Прервать поездку». По решению пользователя в этот тест не входит.

## 4. Как водитель получает заказы

* Только polling, WebSocket в приложении нет (SRC `state/orders/sagas.ts`): готовые заказы — `POST /drive/now` каждые 3 с; активные — `POST /drive?fields=00000000u1` каждые 5 с; на Android Chrome интервалы ×1.75.
* Жёсткий гейт: без `?driverEmulator=1` (или `extEmulator=1`) приложение возвращает водителю **пустые** списки и не опрашивает backend (`tools/emulatorMode.ts`, `isExternalEmulatorEnabled`; `state/orders/selectors.ts:40-52`). Тест обязан открывать водителя по URL с `driverEmulator=1`, как это делают `DRIVER_PAGE` / `DRIVER_LIST_PAGE`.
* Карточка с `data-order-id` есть только на вкладке `detailed`. Вкладка `lite` (по умолчанию, когда `tab` не указан) использует `MiniOrder` без testid.
* Заказ из формы не несёт меток `[E2E …]` / `[DRV:<id>]`; фильтр `filterReadyOrdersByTrainingDriver` (`selectors.ts:102-114`: `!target || target === uid`) показывает водителю заказы со своей меткой **и немеченые**. Опора по коду есть, но подтверждения на live для именно такого заказа и именно для тестового водителя нет (U1).

## 5. Авторизация, наблюдение, независимое чтение, очистка

| Что | Способ | Источник |
|---|---|---|
| Вход в UI | `auth.setup.ts` (проект `setup`): вход через настоящую форму, `storageState` в `e2e/.auth/{driver,passenger,driver2}.json` (gitignored) | SRC |
| Вход в API | `login(account, label)` → `POST /auth`, `/token`; учётные данные из `taxi/.env.e2e.local` / env (`E2E_DRIVER_*`, `E2E_PASSENGER_*`, `E2E_API_BASE`) | SRC `accounts.ts`, `taxiApi.ts` |
| Подготовка водителя | `getDriverCar` → `goOnline(driver, car, PICKUP)`: `POST /car/{c}/drive` + `POST /location` — разрешённое API-предусловие | SRC (как в 002) |
| Два контекста | отдельный `browser.newContext` с `PASSENGER_STORAGE` и `DRIVER_STORAGE`, `geolocation: PICKUP`, `stubMapTiles` (единственный мок) | SRC (как в 002) |
| Захват `b_id` | `watchOrderCreationRequest(page)` **до** клика → `waitForCreated()`; `b_id` берётся из ответа настоящего `POST /drive`; `requests.length` должен быть 1 | SRC `passengerUi.ts:521-583` |
| Независимое чтение | `readOrder(session, b_id)`; `driverStateOf`, `orderDriverStates`, `performersOf`; `listActiveOrders` | SRC `taxiApi.ts` |
| Очистка | `cancelOrder(passenger, b_id)` = `POST /drive/get/{id}`, `action=set_cancel_state`, `b_comments='E2E cleanup'`, без `reason`; по **каждому** `b_id` из `watch.orderIds()` после `watch.settled()` | SRC `taxiApi.ts:514-522`, `passenger-order-creation.spec.ts:155-177` |
| Почему не `cancelTestOrders` | он отменяет только заказы с `[E2E]`/`[DRV:]`/`[CASE]` (`isTestOrder`); у заказа из формы меток нет, а «широкая» уборка запрещена ТЗ §8.4 | SRC |

### Очистка из `Started`: что известно

* README 007 (замер live, 2026-10-03, заказы 16376 и 16377, voting): пассажирский `set_cancel_state` из `Started` → HTTP 200, `b_state 2→3`, `active true→false`, `b_cancel_reason` сохранён; `c_state` водителя остаётся 5 (`README.md:1601-1650`). **README, не перепроверено.**
* `standard-order.spec.ts` (Standard, доходит до `Started`) и `passenger-sos.spec.ts:516` (Standard) вызывают в `afterEach` тот же `cancelOrder` на заказе в `Started`; неудачная отмена печатается как `E2E CLEANUP FAILED`, а уже терминальное состояние отбивается backend как `wrong booking state` (`passenger-sos.spec.ts:183-196`). Зелёные прогоны этих спеков по README (14/14 в CI для 007) означают, что отмена из `Started` проходила. Состояние **после** отмены в 002 независимо не читается, и в этом этапе прогонов не было.
* Исходников backend в репозитории нет (только frontend и живой API), поэтому по backend-коду это проверить нельзя. Остаётся опора на замеры выше.
* Для 009 очистку надо подтверждать независимым `readOrder` → `b_state=3`, `active=false` (+`listActiveOrders` как дополнительная проверка).
* Фронтовый путь отмены — `API.cancelDrive` (`API/order.ts:256-269`), та же `set_cancel_state`.

## 6. Статус проверяемых допущений

| # | Допущение | Статус | Чем подтверждено |
|---|---|---|---|
| U1 | заказ из формы (без метки, `b_car_class=50`, `b_location_class=1`) попадает в `tab=detailed` **тестового** водителя | **LIVE подтверждено** (1 прогон) | заказ `17418`, карточка через ≈3,0 с |
| U2 | принятие такого заказа сразу даёт `c_state=3`, без выбора пассажиром | **LIVE подтверждено** (1 прогон) | `b_state=2`, `drivers=[{871: 3}]` |
| U3 | геокодированная точка посадки (≈30 м от `PICKUP`) укладывается в гейт 100 м для «Приехал» | **LIVE подтверждено косвенно** (1 прогон): кнопка стала доступной, `set_start_state` прошёл | заказ `17490` (этап 2, §12); само расстояние в успешном прогоне не сохранилось |
| U4 | панель водителя у пассажира без клика (авто-выбор) | **LIVE подтверждено** (1 прогон): тест `selectPassengerOrder` не вызывает и панель с `data-order-id`, `state`, `driver-id` дождался | заказ `17490` |
| U5 | очистка | для `Performer` — LIVE (`17418`); **из `Started` для заказа из формы — LIVE подтверждено**: `b_state=3`, не в `listActiveOrders`, запись водителя осталась `c_state=5` | заказ `17490`, независимое чтение архива пассажира |
| U6 | значения `c_state` | `3` — **LIVE** (`17418`); `4` и `5` — **LIVE подтверждено** прохождением тестом (backend опрашивался до нужного значения), итоговое `871:5` видно в архиве | заказ `17490` |
| U7 | локализованные подписи кнопок | «Take order» наблюдалась (английская, несмотря на `ru-RU`); «Поехал»/«Приехал» — **не наблюдались**; тест их не использует | LIVE частично |
| U8 | время появления карточки | ≈3,0 с (одно измерение; опрос 3 с) — таймаут ожидания в тесте оставить с запасом | LIVE |

## 7. Попытка probe и ограничения среды

Это не функциональный дефект приложения, а недоступность внешней инфраструктуры.

* **Прогон `setup` (3 теста) перед probe:** водитель — ok (3,1 мин, одна попытка загрузки не уложилась в 180 с из-за холодной компиляции webpack); **пассажир — упал** (`E2E: приложение не смогло загрузить конфигурацию с бэкенда … «Database is unavailable» (попытка 3 из 3)`, 4,3 мин); второй водитель — ok с двумя перезагрузками «Database is unavailable». Тест `probe` не стартовал (`1 did not run`).
* **Прямая проверка доступности** `E2E_API_BASE` (`GET`, без учётных данных): 2 из 3 запросов зависли на установлении соединения (30 с, `http=000`), третий — 200 за 0,8 с. Корневая страница `https://ibronevik.ru/` отвечала 302 за 0,76 с, контрольный `github.com` — 200.
* **Health-gate перед повторным запуском** (6 подряд запросов, таймаут 6–8 с): 2/6, затем 5/6, 4/6, 3/6, 4/6. Ни разу 6/6. Пороговое условие — 6/6.
* **Решение по попыткам 2026-10-11:** probe не запускался (запущен 2026-10-13 по прямому требованию пользователя, §7.2). При такой доступности отмена заказа после `Started` может не пройти и оставить живой заказ с назначенным тестовым водителем; это ровно тот риск, ради которого в ТЗ требовалась проверка безопасной очистки. В probe добавлены повторы отмены (до 6 попыток с чтением состояния), но связь, которая рвётся, не гарантирует и их.
* `playwright.config.ts`: `retries: CI ? 1 : 0`. Для трёх прогонов «без retry» (этап 3) нужен `--retries=0`, в CI retry=1 включён и скроет нестабильность.
* **Побочный эффект запуска приложения:** `npm start` → `prestart` → `pre-build.js` перезаписывает tracked-файл `taxi/src/version.json`. После каждого запуска приложения нужно `git checkout -- taxi/src/version.json`, иначе он попадёт в diff. Здесь он восстановлен.
* Холодная компиляция dev-сервера занимает ≈3 мин, что целиком съедает первую попытку `expectAppBooted` (180 с). Перед прогонами сервер лучше поднимать заранее: в конфиге `reuseExistingServer: !CI`.
* `tsc --noEmit` проверяет только `src` (`tsconfig.json: include: ["src"]`); `e2e/` проверкой типов проекта не покрывается, отдельного скрипта `typecheck` нет.
* В `e2e/README.md` есть устаревшая строка «Тест ещё не написан» (около стр. 2266) — к 009 отношения не имеет, не правилась.

### 7.1. Повторная предварительная проверка перед ограниченным probe (до `Performer`)

Запросы без учётных данных и без создания заказов (`GET {E2E_API_BASE}`, таймаут 5–8 с).

| Серия | Результат |
|---|---|
| Раунд на 8 запросов | 6/8 |
| 6 раундов по 10 запросов | 6/10, 7/10, 3/10, 7/10, 5/10, 4/10 — **ни одного полного раунда** |
| Разбор 12 запросов (стадии) | 5 из 12 не установили TCP-соединение (`time_connect=0`, curl exit 28 по таймауту 6 с); 7 из 12 — 200 за 0,7–0,9 с |

Что это значит:

* DNS в порядке (5–15 мс), ICMP-ping до `ibronevik.ru` без потерь, контрольный `github.com` стабилен (200 за ≈1 с). Сбой — **не открытие TCP/443 к `ibronevik.ru` примерно в 40% попыток**, а не медленный ответ приложения и не функциональный дефект.
* Когда соединение устанавливается, backend отвечает быстро. Для probe это означает: каждый вызов (создание, чтение, отмена) может независимо упасть, так что отмена после создания остаётся под риском с вероятностью порядка нескольких десятков процентов на попытку.
* Критерий запуска (все запросы раунда успешны) не выполнен ни разу, поэтому по условию пользователя probe **не запускался**, новых заказов **не создавалось**.

Подтверждение безопасной очистки назначенного заказа (проверено по контрактам, без запуска):

| Вопрос | Ответ | Способ |
|---|---|---|
| Поддерживает ли backend пассажирскую отмену заказа после назначения водителя | да: `POST /drive/get/{b_id}`, `action=set_cancel_state`, `reason=…` → HTTP 200 `{"code":"200","status":"success"}`; `b_state 2→3` | README, TEST-E2E-006 (заказы 16101/16102, live gruzvill, 2 одинаковых замера). Это offer-заказ и кнопка UI, **не** Standard из формы и не API-фикстура |
| Что остаётся в записи водителя | `performer` и `c_state=3` **не сбрасываются**; завершённость определяется парой `b_state=3` + `active=false` | README 006; тот же вывод для `Started` (README 007) |
| Можно ли независимо подтвердить результат | да: `readOrder(passenger, b_id)` → `b_state`, `active`, `b_cancel_reason`; `listActiveOrders` — дополнительная проверка | SRC `taxiApi.ts`; в 006/007 именно эта пара проверялась |
| Идентичность очистки по фикстуре | `cancelOrder` шлёт `set_cancel_state` с `b_comments`, **без `reason`**; без `reason` отмена из `Started` в 002/007 проходила; из `Performer` через фикстуру отдельно не замерялась | SRC `taxiApi.ts:514-522`; **не подтверждено** для Standard-заказа из формы в `Performer` |
| Уже терминальный заказ | повторная отмена отбивается `wrong booking state` | SRC `passenger-sos.spec.ts:183-196` |

Вывод: контракт отмены после назначения по документации **подтверждён**, но для конкретно Standard-заказа из формы в `Performer` и именно через фикстуру `cancelOrder` он остаётся замером прежних тестов, а не live-наблюдением этого этапа.

### 7.2. Результат ограниченного probe до `Performer` (2026-10-13)

Условия: dev-сервер поднят заранее; `setup` — водитель ok (3,4 мин, первая загрузка не уложилась в 180 с из-за холодной компиляции), пассажир ok (7,4 с), второй водитель ok (4,1 с); сценарий — 1 passed за 26,3 с. Перед запуском сеть оставалась нестабильной (раунды 8, 6, 6, 8, 9, 8 из 10).

| Шаг | Наблюдение | Заказ |
|---|---|---|
| Подготовка | водитель `871`, машина `103`, класс `50`, `goOnline` на `PICKUP`; пассажир `971` | — |
| Перед | `listActiveOrders` пассажира: 5 заказов (`15778`, `16508`, `16509`, `16510`, `16511`) | чужие, не трогались |
| Создание через форму | один запрос `POST /drive`, HTTP 200 `success`, `b_id=17418`, 403 мс | `17418` |
| Backend после создания | `b_state=1`, `drivers=[]`, `b_cars_count="1"`, `b_custom_comment=""` | `17418` |
| Карточка у водителя | `driver-order-card[data-order-id=17418]`, ≈3,0 с, всего карточек в списке 2 | `17418` |
| Принятие | «Take order»: `set_performer` дважды (первый `error 404`, второй `success 200`) | `17418` |
| Backend после принятия | `b_state=2`, `drivers=[{871: c_state 3}]` | `17418` |
| Панель пассажира | `data-driver-state=3`, `data-driver-id=871` | `17418` |
| Очистка | `cancelOrder` с первой попытки, без ошибок | `17418` |
| Независимое чтение после очистки | `b_state=3`, `drivers=[{871: 3}]` (запись водителя не сбрасывается — как в README 006), `b_cancel_reason=""`, в `listActiveOrders` **нет** | `17418` |
| После | `listActiveOrders`: те же 5 заказов, ничего не появилось и не исчезло | — |

Заметки:

* Поле `active` в ответе `readOrder` **отсутствует** (в probe пришло `null`), поэтому признак «заказ не активен» здесь выводится из пары `b_state=3` + отсутствие в `listActiveOrders`, а не из поля `active`, как писал README 006/007. В тесте опираться на эти два признака.
* `b_cancel_reason` пуст, потому что фикстура отправляет отмену без `reason`.
* Двойной `set_performer` наблюдался на этой машине (`c_id=103`): повтор без `b_driver_code` — это обход в коде приложения, а не дубль назначения. Универсальным правилом для всех машин и водителей это не считается; тест проверяет итог, а не число запросов.
* Заказ `17418` создан и отменён в рамках одного прогона; других заказов в ходе probe не создавалось.
* Один успешный прогон при нестабильной сети — не доказательство надёжности. Разброс времени (3,4 мин на первую загрузку) и риск `Database is unavailable` в `setup` остаются.

Одноразовый probe-spec и временный конфиг сохранены вне репозитория (scratchpad сессии) и в дерево не возвращены; для повторного запуска их надо временно положить в `taxi/e2e/_probe-e2e-009.spec.ts` и `taxi/playwright.probe.config.ts`. Они не коммитятся.

## 8. Baseline (ветка `e2e_taxi_standard_driver_flow`, до каких-либо изменений кода)

| Команда (из `taxi/`) | Результат |
|---|---|
| `npx playwright test --list` | 17 tests in 9 files (setup 3, 001 ×4, 002, 003, 004, 005, 006, 007 ×2, 008 ×3) |
| `npm test` (`CI=true`; `scripts/test.js --watchAll=false`) | 51 suites, 397 tests passed, 0 failed |
| `npx tsc --noEmit` | exit 0 |
| Полный `npm run test:e2e` | **не запускался** (этап 3; backend нестабилен) |

## 9. Селекторы

Критичные для сценария селекторы **есть**: `passenger-order-from/to`, `…-suggestion[data-suggestion-source]`, `passenger-order-phone`, `passenger-order-mode-order`, `passenger-order-form[data-locked]`, `passenger-mini-order[data-order-id]`, `driver-order-card[data-order-id]`, `driver-order-take`, `driver-tab-map`, `driver-map-primary-action[data-driver-state][data-order-id]`, `passenger-driver-panel[data-driver-state][data-driver-id]` (SRC).

Не хватает, но обойтись можно (добавлять в этапе 2 только при необходимости): имя и автомобиль водителя в `passenger-driver-panel`; `data-b-state` на `passenger-mini-order`; testid у кнопок «Поехал»/«Приехал» в `CardModal` (тест их там не использует — идёт через карту).

Дублирующиеся testid, которые нельзя брать без области видимости: `driver-order-take` (CardModal и `pages/Order`), `passenger-sos-open` (`MiniOrders` и `PassengerLiveOrder`).

## 10. Расхождения с формулировкой ТЗ

1. «Прибытие к пассажиру» и «начало поездки» на карте — это кнопки «Поехал» (`set_arrive_state`→`c_state 4`) и «Приехал» (`set_start_state`→`c_state 5`); подписи в `CardModal` поменяны местами. Идентифицировать переход по `data-driver-state`, не по подписи.
2. Для Standard нет формы кода посадки — она только у voting (`Map.tsx:1820`, `isVotingOrder`).
3. Водитель не видит ничего без `driverEmulator=1`; вкладка по умолчанию (`lite`) без testid — нужен `tab=detailed`.
4. Заказ из формы не очищается уборкой по меткам — только по `b_id`.
5. Оптимистичное состояние на карте водителя (см. §3.3): проверять backend независимо.

## 11. Что нужно для завершения этапа 1

Согласованный объём (решение пользователя): **один** probe, ограниченный `Performer`.

Порядок: форма пассажира → `b_id` из ответа `POST /drive` → независимое чтение заказа → карточка именно с этим `b_id` у водителя → клик «Взять заказ» → независимое чтение `c_state=3`, `performersOf == [driver.userId]`, других водителей в игре нет → `passenger-driver-panel[data-driver-state=3][data-driver-id]` у пассажира → адресная отмена по `b_id` (с повторами) → независимое чтение `b_state=3`, `active=false`, `b_cancel_reason` + отсутствие в `listActiveOrders`. `Arrived`/`Started` не вызываются, `cancelTestOrders` не вызывается, чужие заказы не трогаются.

**Выполнено** (§7.2): закрыты U1, U2, U8, U5 (для `Performer`), значение `3` из U6, U4 частично.

**Остаётся неподтверждённым:** U3 (гейт 100 м для «Приехал»), U5 для `Started`, значения `c_state` 4 и 5 на этом заказе, U7 для «Поехал»/«Приехал», автовыбор заказа у пассажира. Закрыть их можно только probe, доводящим заказ до `Arrived`/`Started`, а это требует отдельного решения о безопасной очистке из `Started` (по README она работает, но для заказа из формы не измерялась) и стабильного backend.

## 12. Этап 2 — реализация и контролируемый прогон (2026-10-13)

Тест: `passenger-driver-flow.spec.ts`, проект Playwright `passenger-driver-flow`.

### Реализовано

* Цепочка на одном `b_id`: форма → один `POST /drive` → чтение заказа → карточка водителя по `data-order-id` → «Взять заказ» → backend `Performer` → панель пассажира → «Поехал» (Arrived) → «Приехал» (Started). На этом проверяемый сценарий заканчивается; отмена по API (`cancelOrder`) и её независимое подтверждение — **очистка**, а не проверяемое действие UI (отмену через интерфейс пассажира проверяют TEST-E2E-006 и TEST-E2E-007).
* Каждый переход: сначала backend (`expect.poll` по `readOrder`), затем UI водителя (`data-order-id` + `data-driver-state`), затем UI пассажира (`passenger-driver-panel[data-order-id][data-driver-id][data-driver-state]`). Оптимистичное состояние карты водителя доказательством не служит.
* Исполнитель один (`executorsOf == [driver]`), других водителей «в игре» нет — проверяется после принятия, Arrived и Started.
* `set_performer`: тест не фиксирует число запросов. Проверяется то, что верно при любом их числе: хотя бы один запрос, ровно один успешный, после успешного нового запроса нет, на backend один исполнитель. Последовательность пишется в лог и в аннотацию. Итоговые результаты прогонов — в `README.md`.
* Очистка (`afterEach`): все `b_id` сценария, включая дубли, после ответа на все создающие запросы; до 5 попыток отмены только самой очистки; подтверждение — `b_state=3` и отсутствие в `listActiveOrders` (поле `active` не проверяется). Неподтверждённая очистка — `E2E CLEANUP FAILED` с `b_id` и падение теста.
* `cancelTestOrders` не вызывается; чужие заказы не трогаются.
* Диагностика при падении (`E2E FAILURE DIAGNOSTICS`): этап, `b_id`, id пользователей, HTTP создания, состояние backend, состояние обоих UI, создающие запросы, действия водителя, список созданных заказов, число сбоев соединения при чтении backend. Токены и пароли не печатаются.
* Сбой соединения при **чтении** backend внутри ожиданий считается «значение пока неизвестно» и считается в диагностике; ошибки ответа backend и логические проверки не скрываются. Мутирующие вызовы не повторяются, кроме отмены при очистке.

### Изменения вне spec

| Файл | Что |
|---|---|
| `taxi/src/pages/Passenger/VotingForm.tsx` | один атрибут `data-order-id={lockedOrder.b_id}` на `passenger-driver-panel` (иначе панель нельзя привязать к `b_id`); поведение не менялось |
| `taxi/e2e/fixtures/driverUi.ts` | `driverMapAction`, `expectDriverMapState`, `watchOrderActions` |
| `taxi/e2e/fixtures/passengerUi.ts` | `passengerDriverPanelOfOrder`, `expectPassengerDriverPanel` |
| `taxi/playwright.config.ts` | проект `passenger-driver-flow` |

### Разбор по исходникам

* **Двойной `set_performer`** (замерено на одной машине, `c_id=103`; вывод о всех машинах не делается). `takeOrderRequest` (`API/order.ts:506-566`) всегда добавляет в первый запрос `b_driver_code`, взятый из номера по борту; `getDriverDoorNumber` (`tools/driverDoorNumber.ts`) подставляет `car.c_id`, если он 3–4 цифры (у тестовой машины `103`). Комментарий в коде утверждает, что gruzvill отклоняет `set_performer` с этим полем, и приложение повторяет запрос без него. Для этой машины двойной запрос поэтому детерминирован, для водителя без номера он был бы одинарным. Это обход в production-коде (запрос заведомо отклоняется), исправлять его вне объёма.
* **Когда появляется `passenger-driver-panel`.** Условие: `locked && lockedOrder && selectedDriver && isBlockVisible('driverCard')` (`VotingForm.tsx`). Для Standard `selectedDriver` — первый водитель с `c_state > Canceled`. После создания заказа приложение само выбирает его (`Passenger/index.tsx:160-174`), поэтому `selectPassengerOrder` нужен только при открытии страницы заново; в 009 он не вызывается.
* **Гейт «Приехал».** `disabled = mapActionPending || (requiresPickupArrival && !hasReachedPickup)` (`Map.tsx:3125`). При `driverEmulator=1` браузерный эмулятор выключен, позиция берётся с backend (`c_latitude/c_longitude`), иначе из GPS браузера (`Map.tsx:1660-1661`), радиус 100 м (`tools/driverPosition.ts`).

### Контролируемый прогон

| Запуск | Результат |
|---|---|
| 1-й (с `setup`) | `setup` упал: водитель и второй водитель — «Database is unavailable» и таймаут первой загрузки (холодная компиляция); тест не стартовал, заказов нет |
| 2-й (`--no-deps`, `--retries=0`, сессии из `setup`) | **1 passed, 32,9 с**. Заказ **`17490`**: создан 17:23:45, отменён 17:24:04 |

Независимое чтение архива пассажира после прогона: `17490` — `b_state=3`, `drivers=871:5` (запись водителя осталась `Started`), в `listActiveOrders` его нет; чужие активные заказы `15778`, `16508`–`16511` на месте и не тронуты. Заказы, созданные при разведке и тесте: `17418` (probe, `Performer`) и `17490` (тест, `Started`), оба отменены.

Ограничения прогона:

* Один прогон. Три подряд, регрессионные инъекции, полный набор и CI — этап 3.
* Аннотации и тайминги шагов этого прогона не сохранились: я запустил его с `--reporter=list`, HTML-отчёт не создавался. Данные о `b_id` и очистке получены независимым чтением архива.
* Доступность backend во время запусков колебалась (4/10 → 10/10 → 7/10 по срезам).
* Прогон 2 шёл без `setup` (`--no-deps`): сессии взяты у предыдущих успешных входов (водитель — от probe, пассажир — от 1-го запуска).
