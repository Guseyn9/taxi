# Запуск и эксплуатация

## Среда и ключи

Один FSM deployment/база соответствуют одному Core tenant. Нельзя менять tenant URL у базы с существующими mappings: Core id не содержит tenant. В production нужен HTTPS до Core и FSM, TLS termination, постоянный MySQL volume/backup, Redis для межпроцессных событий и CORS только для согласованных frontend origins.

Переменные из `.env.example`:

| Переменная | Назначение |
|---|---|
| `DB_HOST/PORT/NAME/USER/PASSWORD` | MySQL 8; `READ COMMITTED`, UTC |
| `FSM_ENV` | `local` или `production`; `test` только в тестах |
| `FSM_AUTH_MODE=ibronevik` | проверка пользователя через Core |
| `FSM_EXTERNAL_SYNC_ENABLED=1` | обязателен для рабочего режима |
| `IBRONEVIK_BASE_URL` | точный `/c/{tenant}/api/v1`, HTTPS вне loopback |
| `FSM_CREDENTIAL_KEYS` | общий Fernet-ключ API, FSM и outbox; список для ротации через запятую |
| `FSM_REALTIME_BACKEND=redis`, `FSM_REDIS_URL` | общая доставка событий |
| `FSM_CORS_ORIGINS` | CSV разрешённых frontend origins |
| `FSM_RECONCILE_TOKEN/U_HASH` | отдельная read-only учётная запись для фоновых чтений |

Credentials пользователя и PIN хранятся в зашифрованном виде, отдельно от payload/status/log, с TTL 3600 секунд. При завершении/истечении удаляются. Ключи задаются через секреты среды, не Git/образ. Ротация: сначала новый ключ перед старым на всех процессах; старый убирать после завершения/истечения всех записей, зашифрованных им. Потеря ключа означает отказ незавершённых команд; их нельзя повторно отправлять с новым id без сверки Core.

Тестовые `FSM_API_KEYS_JSON` допускаются только при явно заданном тестовом режиме. Системные таймеры не получают пользовательскую пару автоматически: операции, требующие Core write без инициатора, завершаются отказом. Для production нужно подтвердить, что такие истечения выполняет Core; сервисная запись от чужого имени не подставляется.

## Миграции и процессы

`python -m tools.migrate` применяет bootstrap и 14 SQL-миграций по порядку, хранит SHA256, берёт advisory lock. Повторный запуск — no-op. Изменять уже применённые SQL нельзя; добавляется следующая миграция. 010 заменяет граф и переводит известные старые driver-cancel instances; неизвестные случаи помещает в quarantine. 014 требует уникального `core_order_id`; старые дубли надо разобрать до применения.

Перед первым запуском на существующих данных: backup, остановка старых workers/outbox и проверка дублирующихся mappings. Не запускать одновременно старый `core_http` delivery и новый Core-first worker. Исторические фасады `domains/taxi/actions.py` не являются production entrypoint.

Host-процессы через `tools.run` автоматически читают `.env`. При прямом запуске Python-модулей переменные должны быть предоставлены средой. Docker:

```sh
docker compose -p taxi-fsm-sync-local -f stand/docker-compose.yml -f stand/compose.runtime.yml --profile migration run --rm migrate
docker compose -p taxi-fsm-sync-local -f stand/docker-compose.yml -f stand/compose.runtime.yml up -d api worker outbox
```

Пример Compose — локальный стенд, MySQL без постоянного volume. Он не является production-конфигурацией хранения. В контейнере `127.0.0.1` означает сам контейнер: заменить Core URL из примера на доступный HTTPS target. API публикуется на loopback, дальше нужен согласованный reverse proxy.

Read-only сверка:

```sh
python reconcile_worker.py --once
python reconcile_worker.py --list-mismatches
python -m tools.resolve_mismatch --id 123         # просмотр свежего Core read
python -m tools.resolve_mismatch --id 123 --apply # явное исправление проекции
```

Модули выше читают переменные процесса, не загружают `.env` самостоятельно. Для постоянного reconcile можно использовать `python -m tools.run reconcile` или Compose profile `reconcile`.

Сверка обходит известные mappings, не открывает новые заказы и не выполняет Core mutations. При lock не меняет проекцию. Недостижимое состояние и неоднозначный результат сохраняются в `fsm_sync_mismatches`. Operator repair сверяет Core id и владельца, требует отсутствия активного lock, пишет audit log, сохраняет исходный receipt `FAILED`. Неизвестное создание без Core id автоматически не привязывается: нужен отдельный разбор, иначе возможен дубль заказа.

## Повторные команды и сбои

- Сохранять `Idempotency-Key` до получения receipt. Потерянный receipt можно восстановить GET by-key, затем читать status. Повторный ключ с другим entity/intent/пользователем/несекретным payload отклоняется.
- `write_attempted` сохраняется до HTTP write. После неопределённого результата worker выполняет readback; тот же write не повторяется. Это может требовать ручной сверки, даже если запрос фактически не дошёл.
- Подтверждённый Core отказ → `FAILED`, FSM прежний. Неизвестный исход или Core success + отказ локального перехода → quarantine. Дальнейшие команды отклоняются, snapshot не предлагает действий.
- Отказ проверки авторизации до write допускает ограниченную повторную проверку. Ротация/выход пользователя не должны запускать новый заказ с новым ключом.
- Логи не должны включать remote body, токены или PIN. `/health` проверяет только процесс; дополнительно контролировать возраст pending/outbox, unresolved mismatches, DB/Redis и доступность read-only Core.

## Переключение нашего frontend

Обычная сборка `build:gruzvill` оставляет FSM выключенным. Интеграционная сборка из `taxi/`:

```sh
REACT_APP_FSM_API_URL=https://your-reviewed-fsm-host.example \
REACT_APP_FSM_PASSENGER_ENABLED=true \
node tools/build-fsm.cjs
```

Профиль сам включает `REACT_APP_FSM_COMMAND_STATUS_ENABLED=true`. `REACT_APP_FSM_ENABLED_INTENTS` — CSV канонических intents: не задано — все поддерживаемые; пусто или `none` — ни одного. Для пассажирской части нужен отдельный `FSM_PASSENGER_ENABLED`. Пара берётся из текущего sessionStorage нашего приложения при каждом запросе; чужой модуль авторизации и старое localStorage из Иванова frontend не копировались.

Порядок canary: driver cancel → arrive/start/finish → passenger select/release/cancel → create DIRECT/VOTE/OFFER. CSV `REACT_APP_FSM_ENABLED_INTENTS` задаёт верхнюю границу операций в сборке; для всех поддерживаемых операций оставьте его незаданным. Обычная сборка продолжает держать FSM выключенным.

`build:fsm` включает runtime-политику: перед выбором пути выполняется свежий GET `/api/taxi/features` (`no-store`, без токенов). Backend читает `FSM_FEATURES_FILE` при каждом запросе; файл JSON вида `{"schemaVersion":1,"enabledIntents":["driver_cancel_requested"]}` можно атомарно заменить без перезапуска и frontend-релиза. CSV `FSM_ENABLED_INTENTS` служит альтернативой без файла, но требует перезапуска процесса при изменении. По умолчанию список пустой — новые операции идут legacy.

Compose монтирует **каталог** `stand/features` в `/run/fsm-policy`; это позволяет увидеть атомарную замену `rollout.json`. Для production задайте отдельный `FSM_FEATURES_DIR` с публичной политикой. Не монтируйте отдельный файл через bind, иначе после rename контейнер может остаться на старом inode. Значения — только известные canonical intents; неизвестный intent, отсутствующий/повреждённый файл или недоступный endpoint блокируют новый write, не выбирают legacy автоматически.

Отключение операции влияет на новые отправки. Принятые/неподтверждённые команды, включая FAILED с CORE_OUTCOME_UNKNOWN/CORE_FSM_DIVERGENCE, продолжают проверяться по instanceId или GET by-key; наличие такой команды запрещает переход на legacy до подтверждённого terminal результата. После operator repair браузер проверяет свежий snapshot с совпадающим id и sync=idle, затем снимает блокировку; исходная команда не повторяется, её FAILED receipt остаётся неизменным. Выбранный путь фиксируется на время dispatch, повторного write через другой транспорт после ошибки нет. Runtime policy управляет rollout frontend, не заменяет серверную авторизацию и не отменяет уже принятые команды.

HTTP 401, WS 4401 и подтверждённый command FAILED/CORE_AUTHENTICATION_REQUIRED вызывают повторный вход только если отказ относится к **той же** паре, которая была отправлена. 403/503, отказ прав AUTHORIZATION_FAILED и сетевые закрытия не удаляют сессию. CORE_AUTHENTICATION_REQUIRED выдаётся только после отказа Core /user/authorized, а не отказа прав или истечения зашифрованного stash. Обработка не отправляет Core `/logout`; запоздалый отказ старой пары не затрагивает новый вход. После нового входа надо проверить заказы перед повторной отправкой. Ответы `/api/*`, включая ошибки, получают `Cache-Control: no-store`, чтобы проверка состояния не использовала кэшированную проекцию.

Перед production отключением legacy остаются server acceptance на согласованном tenant, проверка реальных устройств и условия системных таймеров. Кэш/браузерные ошибки не доказывают, что Core не выполнил запись.

## Тесты

Из `backend/`:

```sh
FSM_EXTERNAL_SYNC_ENABLED=0 .venv/bin/python -m unittest discover -s tests -q
# В отдельной test-БД сначала применить миграции с DB_NAME=taxi_fsm_test.
FSM_SYNC_TEST_MYSQL_URL=mysql+mysqlconnector://root:local-fsm-only@127.0.0.1:13318/taxi_fsm_test \
 .venv/bin/python -m unittest discover -s tests -p test_core_first_mysql.py -v
```

CI поднимает чистый MySQL 8, проверяет миграции/повторный запуск и Core-first HTTP mock сценарии. Отдельный `test_core_php_acceptance.py` требует disposable PHP Core и создаёт синтетических пользователей/заказы; он защищён loopback/local URL и не предназначен для публичного tenant. PHP Core не входит в новую CI job. Legacy MySQL/Redis проверки запускаются отдельно через `tests/run_platform_integration.sh`.
