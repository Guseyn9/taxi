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
| 4: наш frontend | текущая session pair, Core-id routes, receipt polling и recovery journal. 202 не означает успех. Legacy fallback после отправки отсутствует. Профили и CSV intents для canary. |
| 4: logout | перед выходом при известной неподтверждённой команде есть предупреждение; отмена сохраняет сессию, подтверждение явно допускает её отзыв. |
| 6: reverse sync | read-only poller известных mappings и чтение при snapshot; невозможные переходы в mismatch journal; operator repair по свежему Core read. |

## Отличия от предварительного плана

1. **Отмена водителем оставляет заказ пассажира открытым.** Настоящий PHP `set_cancel_state` переводит участие этого водителя в `c_state=2`. FSM возвращается в DIRECT created / VOTE waiting / OFFER waiting. История водителя показывает отменённое участие. Пассажирская отмена terminal `order_cancelled`. Проверено на локальном PHP.
2. **Создание — отдельный durable процесс.** Local order и create-key → `/drive` → Core id после подтверждения. OFFER сразу получает waiting-состояние. Старые промежуточные driver-cancel states исключены из активного графа.
3. **Токены нашего frontend в sessionStorage.** Старый модуль авторизации Ивана не заменяет существующий вход. Journal не содержит токенов, PIN, телефона и маршрута.
4. **Flags сборочные.** CSV intents позволяет canary/rollback новой сборкой. Runtime переключение без frontend-релиза пока не реализовано. Неизвестный результат нельзя обходить через legacy.
5. **Таймеры не имитируют пользователя.** Системный Core write без пары инициатора завершается отказом. До полного отключения legacy нужно согласовать, какие истечения выполняет Core сам.

## Проверки

Локально: MySQL 8, Redis 7, одноразовый PHP Core и синтетические пользователи/заказы. Общий gruzvill tenant и production не изменялись.

- Unit discovery: 186 тестов, 156 passed, 30 skipped по явным opt-in условиям.
- Отдельный настоящий MySQL / Core HTTP mock: 19 passed. Phase A без смены state, все 10 пользовательских операций, HTTP200 refusal, unknown write без повтора, restart, конкурентные дубли, changed payload включая race-loser, binding validation, выбор водителя, encrypted PIN и receipt после отмены.
- Legacy MySQL/Redis: 9 passed. Исправлена UTC-ошибка retry-планирования; timestamp fixtures приведены к UTC.
- Настоящий PHP Core: 2 test methods / 5 сценариев — DIRECT, VOTE, OFFER select→arrive→PIN/start→finish, отмена водителем и пассажиром. Отдельная opt-in проверка, не новая CI job.
- Браузер frontend→FSM API→worker/outbox→PHP: create→vote→cancel, Core id 1922, local id 61, `order_cancelled`, sync idle; WS first-message auth. Локальный runtime, не публичный сервер.
- Frontend: 236 suites / 1332 tests passed; TypeScript, ESLint без ошибок; граница 71 бизнес-обработчика — без непросмотренных отличий. Integration build запускается отдельно от стандартной сборки; результат отражён в PR/CI.

Unit discovery запускается с `FSM_EXTERNAL_SYNC_ENABLED=0`: старые fake sessions не эмулируют sync tables. Production с таким флагом запрещён. CI независимо поднимает чистый MySQL, применяет миграции дважды и проверяет Core-first механизм.

## Серверная приёмка

Остаются backend URL/хостинг, постоянная MySQL БД, секреты, совпадающий tenant, read-only reconcile account и target acceptance. Нужны реальные passenger/driver сценарии, устройства, timer contract и пооперационный rollback. `/health` — только liveness.

Не закрыты runtime flags без релиза и production acceptance. Код и локальный стенд подготовлены для PR. Это не отчёт о production deployment. Запуск и восстановление: [RUNBOOK.md](RUNBOOK.md).
