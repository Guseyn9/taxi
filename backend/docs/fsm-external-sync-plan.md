# Синхронизация FSM ↔ внешние сервисы: план перехода

Инструкция для разработки. Описывает переход от текущего состояния, в котором
FSM Platform и iBronevik (Core) не синхронизированы, к единому механизму
вызова внешних сервисов из FSM.

Этапы выполняются по порядку:

1. Механизм «Синхронизация FSM ↔ внешние сервисы» в ядре.
2. Перевод всех операций Taxi, связанных с Core, на этот механизм.
3. Авторизация пользователей через iBronevik и FormData-обработчик для iBronevik.
4. Переключение frontend на Command API.

Этапы 1–2 разрабатываются и проверяются на тестовых API-ключах
(`FSM_API_KEYS_JSON`) и тестовом двойнике Core. Этап 3 заменяет тестовые ключи
настоящими пользователями и включает реальные вызовы iBronevik.

---

## 0. Текущее состояние

### 0.1 Как работает сейчас

| Путь | Что происходит | Синхронизация с Core |
|---|---|---|
| Frontend → iBronevik напрямую (боевой путь) | Назначение, прибытие, старт, завершение, отмена выполняются legacy API из браузера | FSM об этом не знает |
| Command API → worker → FSM | Переход FSM и локальные effects, команда `COMPLETED` | Запроса в Core нет |
| `domains/taxi/actions.py` (`TaxiOrderActions`) | Сначала Core, потом FSM | Мёртвый код: не вызывается, реализации `CoreAdapter` нет |

Итог: синхронизации нет ни в одну сторону. Источник истины по реальным заказам —
Core.

### 0.2 Авторизация сейчас

- **iBronevik.** Пользователь входит в два шага: `POST /auth` → `auth_hash`,
  затем `POST /token` → пара `token` + `u_hash`. Пара передаётся полями FormData
  в каждом запросе. Обновления токена нет, пара действует до `POST /logout`.
- **Frontend.** Пара хранится в браузере: в основном приложении —
  `localStorage['state.user.tokens']` (`apiMethod` в `src/tools/api.ts`), в новом
  модуле авторизации
  [`taxi-auth-frontend`](https://github.com/Lony-35/taxi-auth-frontend) —
  `localStorage['auth.tokens']` (интерфейс `TokenStorage`). Модуль выполняет
  вход, выход, регистрацию и проверку пользователя (`POST /user/authorized`).
  Серверной части у модуля нет.
- **FSM API.** Пользователь определяется по тестовым API-ключам
  `FSM_API_KEYS_JSON` (MVP). С учётными данными iBronevik FSM API не работает.

Следствие: получить токен пользователя на сервере без самого пользователя
нельзя. Учётные данные для вызова iBronevik от имени инициатора может передать
только frontend.

### 0.3 Найденные дефекты

- **Выбранный водитель теряется в Command API.** `payload` команд
  `candidate_selected` / `offer_selected` / `direct_assignment_requested` не
  читается ни guard, ни effect. `create_trip` создаёт поездку с
  `driver_user_id = NULL`, `performer_local_user_id` и `selected_candidate` не
  заполняются. Назначенный так водитель не видит заказ и не проходит проверку
  «назначенный водитель». Исправить до этапа 2.
- **Outbox ни к одной операции не подключён.** Effect `write_core_outbox`
  зарегистрирован, но не назначен ни одному переходу в seed.
- **`HttpJsonOutboxHandler` не подходит для iBronevik**: отправляет JSON и Bearer,
  а iBronevik ждёт FormData с `token` / `u_hash` и возвращает ошибки с HTTP 200.

### 0.4 Промежуточный результат (отмена водителем, 2026-09)

Сделано и покрыто тестами (48 тестов отмены, включая негативные сценарии):

- intent `driver_cancel_requested` (`driver.order.cancel`), 403 для всех, кроме
  назначенного водителя (`domains/taxi/security.py`, command policy);
- guard `can_driver_cancel_order`;
- отложенное завершение команды (`fsm_core/command_completion.py`), follow-up
  triggers из outbox (`completion_json`, миграция `008`);
- бывшие кандидаты теряют доступ к заказу после назначения;
- WebSocket-обработчик сразу освобождает подписку при отключении клиента.

**Расходится с целевой архитектурой:** отмена реализована через промежуточное
состояние `order_driver_cancel_pending` и откат. На этапе 1 переделывается.
Не выкатывать на живое окружение: без обработчика iBronevik запрос в Core
падает, а без запущенного `outbox_worker.py` заказ остаётся в ожидании.

---

## 1. Принятые архитектурные решения

1. **Сначала внешний сервис, потом переход FSM.** Состояние заказа меняется
   только после успешного ответа. При отказе состояние не меняется, откатывать
   нечего, локальные effects не выполнялись.
2. **Ожидание — вне FSM.** Промежуточные состояния («ожидание Core») для
   операций не вводятся. Общее состояние «Ожидание» тоже не вводится: оно
   скрывает настоящее состояние заказа, ломает snapshot, таймеры и guards.
   Иерархических и параллельных состояний ядро не поддерживает
   (спецификация §28, Capability Matrix).
3. **Общая блокировка сущности в ядре.** Пока по сущности идёт внешний вызов,
   любые другие переходы по ней отклоняются.
4. **Ожидание хранится в БД, а не в памяти.** Вызов — строка `core_outbox`
   (повторы, `Idempotency-Key`), результат — follow-up trigger:
   успех → переход FSM → команда `COMPLETED`; отказ → команда `FAILED`
   (+ необязательный переход).
5. **Guard проверяет инициатора.** Правило «кто может выполнить команду»
   проверяется дважды одной функцией: в command policy при приёме (быстрый 403)
   и в guard в момент перехода (на заблокированных данных).
6. **Одна пара учётных данных для FSM API и для iBronevik.** Frontend передаёт
   `token` + `u_hash` пользователя в каждом запросе к FSM API. FSM API проверяет
   пару в iBronevik и по ней определяет пользователя; та же пара используется
   для вызова iBronevik от имени инициатора. Тестовые API-ключи остаются
   только для тестов.

Отклонённые варианты и причины:

| Вариант | Почему нет |
|---|---|
| Всё в одной транзакции с синхронным вызовом Core | Core не участник транзакции: при таймауте Core может выполнить операцию, а мы откатимся. Нарушает инвариант 10 |
| Переход FSM сразу + откат при отказе (saga) | Нужны компенсирующие effects для каждой операции (например, удаление `taxi_trips`); ошибки компенсации трудно разбирать |
| Промежуточное состояние на каждую операцию | Удваивает граф состояний |
| TCC (резерв → подтверждение) | iBronevik не поддерживает резервирование |
| Сервер сам получает токен пользователя | iBronevik выдаёт токен только по логину и паролю пользователя; серверного API выдачи токена нет |
| Сервисная учётная запись для всех вызовов | Нарушает правило «вызов от имени инициатора»; iBronevik не сможет проверить права конкретного пользователя |

---

## 2. Этап 1. Механизм в ядре

### 2.1 Объявление внешнего вызова для перехода

Новая таблица (миграция `009_transition_invocations.sql`):

```sql
CREATE TABLE fsm_transition_invocations (
    transition_id     INT          NOT NULL PRIMARY KEY,  -- fsm_transitions.id
    handler_name      VARCHAR(100) NOT NULL,              -- outbox handler, например 'ibronevik'
    request_builder   VARCHAR(100) NOT NULL,              -- имя функции домена
    on_error_trigger  VARCHAR(100) NULL,                  -- необязательная реакция на отказ
    max_wait_seconds  INT          NOT NULL DEFAULT 600,
    CONSTRAINT fk_fsm_transition_invocations
        FOREIGN KEY (transition_id) REFERENCES fsm_transitions (id)
);
```

- Переход без строки в этой таблице работает как сейчас.
- `request_builder` — функция домена, зарегистрированная в Registry
  (`registry.register_request_builder(name, fn)`). Она получает pre-transition
  Context и payload команды и возвращает запрос к внешнему сервису
  (`{"method", "path", "body"}` или доменный формат обработчика).
- Registry при старте проверяет, что все `handler_name` и `request_builder`
  зарегистрированы (как сейчас для guard/effect).

### 2.2 Блокировка сущности

Новая таблица:

```sql
CREATE TABLE fsm_entity_locks (
    service             VARCHAR(50)  NOT NULL,
    entity_type         VARCHAR(50)  NOT NULL,
    entity_id           INT          NOT NULL,
    command_instance_id BIGINT       NULL,
    outbox_event_id     BIGINT       NOT NULL,
    action_name         VARCHAR(100) NOT NULL,
    locked_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          DATETIME     NOT NULL,
    PRIMARY KEY (service, entity_type, entity_id)
);
```

- Первичный ключ гарантирует не больше одного внешнего вызова на сущность;
  конкурентная вставка получает duplicate key → конфликт.
- Проверка в двух местах:
  - `CommandService.accept`: есть блокировка → **HTTP 409 Conflict**
    (`ENTITY_SYNC_IN_PROGRESS`), instance не создаётся;
  - `TransitionRunner` перед любым переходом: есть блокировка → отказ
    `ENTITY_SYNC_IN_PROGRESS`. Исключение — follow-up triggers этой блокировки
    (сверяется `outbox_event_id`).
- Снимается в той же транзакции, что и follow-up переход или отказ.
- Сторож: блокировка с истёкшим `expires_at` при терминальном outbox → снятие
  с записью ошибки; при нетерминальном — предупреждение в лог (не снимать
  молча).

Новый машинный код ошибки `ENTITY_SYNC_IN_PROGRESS` добавить в
`fsm_core/error_codes.py` и README.

### 2.3 Выполнение перехода с внешним вызовом

**Фаза A — запрос** (worker, транзакция команды):

1. Context Builder: сущность `FOR UPDATE` + инициатор команды
   (`requested_by_user_id`, роль).
2. Resolve action, load transition.
3. Guard (в том числе проверка инициатора).
4. Проверка блокировки.
5. `request_builder` → запрос; `enqueue_outbox_event(..., completion=...)`,
   в `completion_json`: `commandInstanceId`, `action`, `expectedState`
   (текущее состояние), payload команды. Учётные данные инициатора — в
   отдельную колонку (раздел 4.3), не в `completion_json` и не в payload.
6. Вставка `fsm_entity_locks`.
7. SQL Core **не вызывается**; команда остаётся `PROCESSING`
   (`defer_current_command_completion`).
8. Commit.

**Фаза B — успех** (follow-up trigger подтверждения):

1. Context `FOR UPDATE`, повторный guard.
2. SQL Core с `expected_state` из `completion_json` → effects → realtime event.
3. Сохранение ответа внешнего сервиса (например, `b_state`) через доменный
   `response_handler`, если объявлен.
4. Снятие блокировки, команда `COMPLETED`. Commit.
5. Если шаги 1–2 не прошли: команда `FAILED` с сообщением
   «внешний сервис выполнил операцию, FSM — нет», блокировка снимается,
   событие пишется в журнал расхождений (раздел 6.2). Это единственный случай
   расхождения; вероятность низкая, так как сущность была заблокирована.

**Фаза C — отказ** (follow-up trigger отказа):

1. Снятие блокировки, команда `FAILED` с ошибкой внешнего сервиса.
2. Если объявлен `on_error_trigger` — поставить его в очередь.
3. Состояние сущности не меняется.

Существующий механизм `command_completion.py` / `completion_json` /
`_settle_linked_command` переиспользуется; меняется только то, что фаза A не
выполняет переход.

### 2.4 Повторные и окончательные ошибки

Outbox-обработчик классифицирует ошибку:

| Тип | Примеры | Поведение |
|---|---|---|
| Временная | таймаут, сетевой сбой, HTTP 5xx | `RETRY` с backoff |
| Окончательная | бизнес-отказ Core, ошибка авторизации (HTTP 401, недействительная пара `token`/`u_hash`), прочие 4xx | сразу `FAILED` без повторов → фаза C |

Добавить в `fsm_core/outbox.py` исключение `PermanentDeliveryError`; dispatcher
при нём ставит `FAILED` независимо от числа попыток.

### 2.5 Snapshot

В snapshot сущности (order и агрегат driver) добавить:

```json
"sync": {"status": "pending", "action": "order_cancel_by_driver", "since": "..."}
```

`status`: `pending` (есть блокировка) или `idle`. Последняя ошибка
синхронизации доступна через статус команды. Строится при чтении из
`fsm_entity_locks`, отдельно не хранится.

### 2.6 Переделка отмены водителем

- Удалить `order_driver_cancel_pending`, `order_confirm_driver_cancel`,
  `order_revert_driver_cancel_*`, effects `request_core_driver_cancel` /
  `finish_driver_cancel_request`, `metadata.driver_cancel`.
- Переходы `order_cancel_by_driver`: из `order_vote_driver_assigned`,
  `order_driver_assigned`, `order_driver_arrived` сразу в `order_cancelled`,
  с invocation `set_cancel_state`.
- Миграция данных: заказы в `order_driver_cancel_pending` (если появятся на
  тестовых стендах) вернуть в `metadata.driver_cancel.previous_state`.

### 2.7 Критерии готовности этапа 1

- Юнит-тесты: фазы A/B/C, блокировка (409 при приёме, отказ в runtime,
  исключение для follow-up), истёкшая блокировка, окончательная ошибка без
  повторов, повторная проверка guard в фазе B, конфликт `expected_state`.
- Все существующие тесты проходят, включая тесты отмены (переписанные под
  новую схему).
- Интеграционный тест на MySQL 8: полная цепочка с тестовым двойником Core.
- Документация: README, `fsm-platform-lifecycle.md`, раздел в спецификации.

---

## 3. Этап 2. Перевод операций Taxi на механизм

### 3.1 Предварительно

- Исправить потерю выбранного водителя (раздел 0.3): request builder и effect
  назначения должны брать водителя из payload команды, effect — записывать
  `selected_candidate` / `selected_offer` и `performer_local_user_id`.
- Решить судьбу `core_order_mapping`: таблица создавалась для Courier, но
  используется Taxi (связь с Core-заказом, исполнитель). Либо признать общей,
  либо завести `taxi_core_order_mapping`.

### 3.2 Операции

| Intent | FSM action | Вызов iBronevik (`POST /drive/get/{id}`) | Реакция на отказ Core |
|---|---|---|---|
| `vote_requested` | `order_publish_vote` | `set_confirm_state` | FAILED, заказ остаётся `order_created` |
| `offer_requested` | `order_publish_offer` | нет вызова (уточнить) | — |
| `direct_assignment_requested` | `order_assign_direct` | `set_performer`, `performer=1` | FAILED |
| `candidate_selected` | `order_select_candidate` | `set_performer`, `performer=1` | FAILED; если «заказ уже занят» — `on_error_trigger` на обновление snapshot/уведомление |
| `candidate_released` | `order_release_candidate` | `set_performer`, `performer=0` | FAILED |
| `offer_selected` | `order_select_offer` | `set_performer`, `performer=1` | FAILED |
| `driver_arrived` | `order_arrive` | `set_arrive_state` | FAILED |
| `ride_started` | `order_start` | `set_start_state` | FAILED |
| `ride_finished` | `order_finish` | `set_complete_state` | FAILED + ручной разбор (поездка фактически окончена) |
| `cancel_requested` | `order_cancel_by_client` | `set_cancel_state` | FAILED |
| `driver_cancel_requested` | `order_cancel_by_driver` | `set_cancel_state` | FAILED |
| `order_expired` | `order_expire` | уточнить, отменяет ли Core сам | — |
| `pickup_timeout` | `order_no_show` | уточнить | — |
| `ride_interrupted` | `order_interrupt_ride` | уточнить | — |

Системные triggers (`order_expired`, `pickup_timeout`) инициирует не
пользователь, а таймер. Если для них нужен вызов iBronevik, для него нет
учётных данных инициатора — сначала выяснить, выполняет ли Core эти действия
сам.

Отдельно — **создание заказа** (`POST /drive`): Core возвращает `core_order_id`,
до ответа локального заказа с привязкой нет. Нужен отдельный процесс создания
(локальная запись + вызов + сохранение `core_order_id` в фазе B). Проработать
отдельно.

### 3.3 Для каждой операции

1. Request builder в домене Taxi.
2. Строка в `fsm_transition_invocations` (seed).
3. Правило инициатора в command policy и guard, если операция доступна не всем
   участникам заказа.
4. Тесты: успех, окончательный отказ, временный отказ → повтор, блокировка,
   повторная команда во время ожидания.

### 3.4 Критерии готовности этапа 2

- Все операции из таблицы 3.2 с вызовом Core объявлены через invocation.
- `TaxiOrderActions` и `CoreAdapter` удалены (заменены request builders).
- Тесты по каждой операции, включая негативные.

---

## 4. Этап 3. Авторизация через iBronevik и FormData-обработчик

### 4.1 Схема

```text
Frontend (taxi-auth-frontend: вход /auth → /token, пара token + u_hash)
   │  запрос к FSM API с заголовками пары
   ▼
FSM API: IbronevikPrincipalProvider
   │  POST /user/authorized (token, u_hash) → пользователь (u_id, роль)
   │  Principal(user_id, roles)
   ▼
CommandService → worker (фаза A): пара → отдельная колонка core_outbox
   ▼
OutboxDispatcher → обработчик ibronevik: FormData(action, …, token, u_hash)
   ▼
iBronevik выполняет операцию от имени инициатора; пара стирается
```

### 4.2 Вход в FSM API по паре iBronevik

Новый `IbronevikPrincipalProvider` (`fsm_core/security.py` или доменный модуль)
заменяет `ApiKeyPrincipalProvider` в боевой конфигурации.

- **Заголовки HTTP-запроса:** `X-Auth-Token` и `X-Auth-U-Hash` (имена
  согласовать с frontend). Пара не передаётся в query string и в теле команды.
- **Проверка:** `POST {IBRONEVIK_BASE_URL}/user/authorized` с FormData
  `token`, `u_hash`. Ошибка — `status == "error"` или HTTP 401 → 401 от FSM API.
- **Principal:** `user_id` — `u_id` пользователя iBronevik; роль — из `u_role`
  (соответствие ролей iBronevik ролям FSM: `client`, `driver`, `admin` и др. —
  утвердить таблицей). Роль из запроса клиента не принимается.
- **Кэш:** результат проверки кэшируется по хэшу пары на короткое время
  (например, 60 секунд), чтобы не вызывать iBronevik на каждый запрос. Сама
  пара в кэше хранится только в памяти процесса.
- **Тестовые ключи:** `ApiKeyPrincipalProvider` остаётся для тестов и
  интеграционного стенда; выбор провайдера — переменной окружения.
- **Идентификаторы пользователей:** проверить, что `requested_by_user_id`,
  `client_local_user_id`, `performer_local_user_id`, `candidates[].user_id`
  хранят `u_id` iBronevik. Если в FSM используются собственные (локальные)
  идентификаторы — нужна таблица соответствия; без этого правило «назначенный
  водитель» будет сравнивать разные идентификаторы.

**WebSocket.** Браузерный WebSocket не передаёт заголовки. Клиент после
подключения первым сообщением отправляет
`{"type": "auth", "token": "...", "u_hash": "..."}`; сервер проверяет пару тем же
провайдером и только после этого отправляет snapshot. Нет сообщения за 10 секунд
или пара недействительна → закрытие с кодом `4401`. Query string для пары не
использовать: она попадает в логи прокси.

### 4.3 Хранение пары для вызова iBronevik

- `CommandService.accept` получает пару из запроса вместе с Principal и
  передаёт её worker'у через отдельную таблицу или колонку, **не** через
  `trigger_payload`.
- В фазе A пара записывается в отдельную колонку `core_outbox`
  (например, `credentials_encrypted`), зашифрованной ключом из переменной
  окружения.
- Пара **не попадает** в `server_fsm_instances.trigger_payload`,
  `fsm_command_idempotency.response_json`, `realtime_events`,
  `core_outbox.payload` / `completion_json` / `last_error`, логи и ответы API.
- Колонка очищается при терминальном `SENT` / `FAILED` и при снятии блокировки
  сторожем.
- Команда без пары (например, от тестового ключа) для перехода с вызовом
  iBronevik отклоняется при приёме: `INVALID_PARAMETERS`.

### 4.4 Обработчик iBronevik

Новый outbox handler `ibronevik` (`domains/taxi/ibronevik_handler.py` или
`fsm_core/handlers/`):

- `POST {IBRONEVIK_BASE_URL}/drive/get/{core_order_id}`, тело FormData:
  `action`, параметры действия, `token`, `u_hash` (расшифрованные из колонки
  события);
- `IBRONEVIK_BASE_URL` — `https://ibronevik.ru/taxi/c/{config}/api/v1`; тот же
  адрес, что `VITE_AUTH_API_URL` в `taxi-auth-frontend`, иначе пара не будет
  действительна;
- ошибка определяется по обоим признакам: `status == "error"` **и**
  `code != "200"`, при любом HTTP-статусе (iBronevik отвечает ошибками с HTTP 200);
- классификация (раздел 2.4): бизнес-отказ и ошибка авторизации —
  окончательные, сеть и 5xx — временные;
- из ответа извлекается `b_state` для `response_handler`.

### 4.5 Жизненный цикл пары

- Обновления токена у iBronevik нет. Если пользователь вышел (`POST /logout`)
  или сессия стала недействительной, пока событие ждёт повтора, iBronevik
  ответит ошибкой авторизации → окончательный `FAILED` без повторов, состояние
  заказа не меняется.
- Frontend при 401 от FSM API отправляет пользователя на повторный вход
  (`taxi-auth-frontend`), затем повторяет действие новой командой.

### 4.6 Идемпотентность

Outbox доставляет «хотя бы один раз». Выяснить, поддерживает ли iBronevik
`Idempotency-Key`. Если нет — перед повтором обработчик запрашивает состояние
заказа в Core и не повторяет уже применённую операцию (например, повторный
`set_cancel_state` для отменённого заказа считается успехом).

### 4.7 Критерии готовности этапа 3

- Тесты провайдера: действительная пара, недействительная пара, ошибка с
  HTTP 200, недоступность iBronevik, кэш, соответствие ролей.
- Тесты WebSocket: первое сообщение `auth`, таймаут, недействительная пара.
- Тесты обработчика на записанных ответах iBronevik: успех, бизнес-отказ,
  ошибка авторизации, ошибка с HTTP 200, таймаут.
- Проверка, что пара отсутствует во всех таблицах и логах из раздела 4.3 после
  доставки.
- Прогон вручную на тестовом аккаунте iBronevik: вход через
  `taxi-auth-frontend`, назначение, прибытие, старт, завершение, отмена.

---

## 5. Этап 4. Переключение frontend (ответственный — Иван)

### 5.1 Порядок

Переключать по одной операции, за feature-флагом на каждую операцию, чтобы
можно было вернуть legacy-путь без релиза:

1. Вход через `taxi-auth-frontend`; передача пары `token` + `u_hash` во все
   запросы к FSM API (HTTP-заголовки и первое сообщение WebSocket).
2. Отмена водителем (`driver.order.cancel`).
3. Прибытие, старт, завершение.
4. Выбор кандидата / оффера пассажиром, отмена пассажиром.
5. Создание заказа (после проработки раздела 3.2).

### 5.2 Требования к frontend

- Пара берётся из `TokenStorage` модуля авторизации и передаётся заголовками
  `X-Auth-Token` / `X-Auth-U-Hash` в каждом запросе к FSM API; в WebSocket —
  первым сообщением `auth`.
- `401` от FSM API или закрытие WebSocket с кодом `4401` — повторный вход.
- Команды отправляются через `FsmTaxiCommandTransport` с intent из таблицы 3.2
  (или frontend-алиасом, например `driver.order.cancel`).
- `202` — команда принята, не выполнена. Результат — только через
  `GET /api/commands/{instanceId}` или изменение snapshot.
- `PROCESSING` может длиться до `max_wait_seconds`: показывать «идёт
  синхронизация», не блокировать интерфейс намертво.
- `snapshot.sync.status == "pending"` — показывать «синхронизация» поверх
  состояния заказа, кнопки действий неактивны.
- `409 ENTITY_SYNC_IN_PROGRESS` — «по заказу выполняется операция, повторите
  позже».
- `403` — действие недоступно этому пользователю.
- `FAILED` — показать `errorMessage`, обновить snapshot. Ошибка авторизации
  iBronevik в `errorMessage` — повторный вход.
- После потери связи: повторять тот же запрос с тем же `Idempotency-Key`,
  затем опрашивать статус команды.
- Не выполнять `POST /logout`, пока есть команды в `PROCESSING`, либо
  предупреждать пользователя, что незавершённые операции будут отклонены.
- Для переключённой операции удалить прямой вызов iBronevik.

### 5.3 Критерии готовности этапа 4

- Все операции идут через Command API, прямых вызовов iBronevik для них нет.
- FSM API в боевой конфигурации работает без тестовых API-ключей.
- Проверены сценарии потери связи, повторного нажатия и выхода из аккаунта
  во время ожидания.
- Feature-флаги можно удалить после стабилизации.

---

## 6. Дополнительно (после этапа 2, до полного отключения legacy)

### 6.1 Обратная синхронизация Core → FSM

Пока часть изменений происходит в iBronevik напрямую (legacy frontend,
операторы, собственные таймауты Core), FSM отстаёт. Нужно:

- выяснить, есть ли у iBronevik webhook; если нет — периодический опрос
  изменённых заказов;
- отображение `b_state` → доменное событие FSM (trigger типа `event`);
- идемпотентное применение (повторное событие не меняет состояние дважды).

Опрос выполняется сервером без пользователя, поэтому для него нужна отдельная
учётная запись iBronevik с правом чтения заказов (только чтение, не для
выполнения операций от имени пользователей).

### 6.2 Сверка

Периодическая задача сравнивает состояние заказов в Core и FSM, записывает
расхождения в журнал и показывает их оператору. Сюда же попадают случаи
фазы B, шаг 5.

---

## 7. Риски

| Риск | Мера |
|---|---|
| Сущность надолго заблокирована при недоступном Core | `max_wait_seconds`, окончательный отказ по таймауту, сторож блокировок |
| Core выполнил, FSM не смог (фаза B) | Журнал расхождений, сверка, ручной разбор |
| Повторная операция в Core при повторе outbox | `Idempotency-Key` или проверка состояния перед повтором (4.6) |
| Утечка пары `token` / `u_hash` | Заголовки вместо query string, шифрование в `core_outbox`, стирание после доставки, запрет записи в логи и журналы (4.3) |
| Пользователь вышел или сессия истекла, пока событие ждёт повтора | Окончательный `FAILED` без повторов, состояние не меняется (4.5); предупреждение на frontend |
| Нагрузка на iBronevik от проверки пары | Кэш результата проверки (4.2) |
| Разные идентификаторы пользователей в FSM и iBronevik | Проверка перед этапом 3, при необходимости таблица соответствия (4.2) |
| Одновременная работа legacy frontend и Command API по одному заказу | Переключение по операциям с флагами, обратная синхронизация (6.1) |
| `outbox_worker.py` не запущен | Мониторинг backlog outbox, алерт; блокировки истекают по сторожу |
