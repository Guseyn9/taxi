# Реализация плана FSM ↔ Core — 8 ноября 2026

Исходная точка: `backend.zip`, план из `Ivan.zip`, наш frontend r18 `bfc6cb1`. Мобильные замечания вынесены в PR #58 (`c4c9b2f`); backend-ветка включает этот же commit. Старый Иванов frontend не переносился. MySQL 8 требуется исходным SQL runtime; доступа к рабочей базе Core для этого не требуется.

## Сверка с планом

| Пункт | Реализация |
|---|---|
| 1: внешний вызов | `fsm_transition_invocations`, обязательные bindings при startup, SQL entity lock, durable outbox. Phase A не меняет бизнес-состояние. Phase B атомарна с SENT/FAILED. `on_error_trigger` поддерживается для явно настроенных bindings. |
| 1: сбои | повторные ключи и payload digest, committed write marker до HTTP, readback вместо повтора неизвестного write, quarantine и immutable terminal receipts. |
| 2: выбранный водитель | проверка по Core-imported candidates/offers; выбранный водитель и performer записываются до trip effect только после Core ACK. |
| 2: операции | create DIRECT/VOTE/OFFER, publish vote/offer, direct assignment, candidate select/release, offer select, arrive, PIN/start, finish, client/driver cancel через общий механизм. |
| 3: авторизация | Core `/user/authorized`, verified role/id, FormData token/u_hash; production не допускает test API keys. Cache по hash всей пары. HTTP200 с business error — отказ. |
| 3: credentials | Fernet + rotation + TTL, отдельная колонка, стирание при terminal/expiry. PIN зашифрован, отсутствует в публичных payload/status и digest. |
| 3: WebSocket | первое auth-сообщение, deadline 10 секунд, нет токенов в query string. |
| 4: наш frontend | текущая session pair, Core-id routes, receipt polling и recovery journal. 202 не означает успех. Legacy fallback после отправки отсутствует. Профили, build ceiling и runtime JSON policy для canary без пересборки. |
| 4: logout | перед выходом при известной неподтверждённой команде есть предупреждение; отмена сохраняет сессию, подтверждение явно допускает её отзыв. |
| 6: reverse sync | read-only poller известных mappings и чтение при snapshot; невозможные переходы в mismatch journal; operator repair по свежему Core read. |

## Отличия от предварительного плана

1. **Отмена водителем оставляет заказ пассажира открытым.** Настоящий PHP `set_cancel_state` переводит участие этого водителя в `c_state=2`. FSM возвращается в DIRECT created / VOTE waiting / OFFER waiting. История водителя показывает отменённое участие. Пассажирская отмена terminal `order_cancelled`. Проверено на локальном PHP.
2. **Создание — отдельный durable процесс.** Local order и create-key → `/drive` → Core id после подтверждения. OFFER сразу получает waiting-состояние. Старые промежуточные driver-cancel states исключены из активного графа.
3. **Токены нашего frontend в sessionStorage.** Старый модуль авторизации Ивана не заменяет существующий вход. Journal не содержит токенов, PIN, телефона и маршрута.
4. **Runtime flags реализованы.** Fresh no-store GET перед выбором пути, JSON-файл перечитывается backend без restart, default — все intents выключены. Неизвестный результат нельзя обходить через legacy.
5. **Таймеры не имитируют пользователя.** Системный Core write без пары инициатора завершается отказом. До полного отключения legacy нужно согласовать, какие истечения выполняет Core сам.

## Проверки

Локально: MySQL 8, Redis 7, одноразовый PHP Core и синтетические пользователи/заказы. Общий gruzvill tenant и production не изменялись.

- Unit discovery: 192 теста, 161 passed, 31 skipped по явным opt-in условиям.
- Отдельный настоящий MySQL / Core HTTP mock: 20 passed. Phase A без смены state, все 10 пользовательских операций, HTTP200 refusal, unknown write без повтора, restart, конкурентные дубли, changed payload включая race-loser, binding validation, выбор водителя, encrypted PIN и receipt после отмены.
- Runtime/re-auth regression: hot-file policy, malformed/missing config, отсутствие POST при отказе чтения, recovery после отключения, защита от смены маршрута внутри dispatch, HTTP401/WS4401 и late-refusal после нового входа. Отказ прав не вызывает logout; Core session refusal имеет отдельный machine code CORE_AUTHENTICATION_REQUIRED. Service 5xx/429 внутри HTTP200 не считается неверной сессией. FAILED/unknown и divergence остаются блокирующими до подтверждённого sync=idle для того же заказа; исходный write не повторяется.
- Legacy MySQL/Redis: 9 passed. Исправлена UTC-ошибка retry-планирования; timestamp fixtures приведены к UTC.
- Настоящий PHP Core: 2 test methods / 5 сценариев — DIRECT, VOTE, OFFER select→arrive→PIN/start→finish, отмена водителем и пассажиром. Отдельная opt-in проверка, не новая CI job.
- Браузер frontend→FSM API→worker/outbox→PHP: create→vote→cancel, Core id 1922, local id 61, `order_cancelled`, sync idle; WS first-message auth. Локальный runtime, не публичный сервер.
- Frontend: 237 suites / 1354 tests passed; TypeScript, ESLint без ошибок; граница 71 бизнес-обработчика — без непросмотренных отличий. Integration build запускается отдельно от стандартной сборки; результат отражён в PR/CI.

Unit discovery запускается с `FSM_EXTERNAL_SYNC_ENABLED=0`: старые fake sessions не эмулируют sync tables. Production с таким флагом запрещён. CI независимо поднимает чистый MySQL, применяет миграции дважды и проверяет Core-first механизм.

## Серверная приёмка

Остаются backend URL/хостинг, постоянная MySQL БД, секреты, совпадающий tenant, read-only reconcile account и target acceptance. Нужны реальные passenger/driver сценарии, устройства, timer contract и пооперационный rollback. `/health` — только liveness.

Не закрыта production acceptance; runtime flags, re-authentication, запрет scope-auth вне тестовой среды и no-store для API закрыты кодом и regression-тестами. Код и локальный стенд подготовлены для PR. Это не отчёт о production deployment. Запуск и восстановление: [RUNBOOK.md](RUNBOOK.md).
