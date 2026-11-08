# Taxi FSM / iBronevik integration

Состояние: 8 ноября 2026. Рабочая интеграционная ветка на базе нашего frontend r18, с отдельным исправлением мобильной карты. Импортирован исходный Python FSM из `backend.zip`; frontend из Ivan.zip не используется. Происхождение: [SOURCE_ARCHIVE.json](SOURCE_ARCHIVE.json). Полученное описание сохранено как [README.received.md](README.received.md), оно описывает старую реализацию.

Система использует MySQL 8: полученный runtime и процедуры написаны под MySQL. PostgreSQL Core, если он есть в другой среде, этим пакетом не заменяется и не мигрируется. Core подключается через HTTP, его база напрямую приложению не нужна.

FSM сначала принимает команду и сохраняет зашифрованные учётные данные инициатора. Worker резервирует сущность и создаёт outbox, оставляя бизнес-состояние прежним. Только после подтверждения Core outbox атомарно применяет FSM-переход, effects и `COMPLETED`. Отказ сохраняет исходное состояние. Неизвестный результат записи блокирует дальнейшие изменения до сверки, без слепой повторной отправки.

- [План Валентина](docs/fsm-external-sync-plan.md) — исходный документ; его замечания о хранении frontend-токенов и промежуточных состояниях не являются описанием текущего r18.
- [Запуск, настройка и восстановление](RUNBOOK.md).
- [Отчёт по реализации и проверкам](INTEGRATION.md).

## Локальный запуск

Команды выполняются из `backend/`. Нужны Python 3.12, Docker, MySQL 8 и Redis 7.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
# В .env установить URL своего тестового Core и общий FSM_CREDENTIAL_KEYS.
# Ключ генерируется один раз: .venv/bin/python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
docker compose -p taxi-fsm-sync-local -f stand/docker-compose.yml up -d --wait
.venv/bin/python -m tools.run migrate
```

В отдельных терминалах:

```sh
.venv/bin/python -m tools.run api
.venv/bin/python -m tools.run worker
.venv/bin/python -m tools.run outbox
```

`.env.example` содержит URL локального disposable PHP Core; сам Core в этот архив не включён. `stand/core_proxy.py` предназначен только для уже подготовленного одноразового локального контейнера Core. Не использовать общий dev/prod tenant для разрушительных тестов.

Проверка без MySQL:

```sh
FSM_EXTERNAL_SYNC_ENABLED=0 .venv/bin/python -m unittest discover -s tests -q
```

Интеграционная проверка требует отдельной пустой БД с именем, заканчивающимся на `_test`, миграций и `FSM_SYNC_TEST_MYSQL_URL`. Тесты удаляют только fixture-таблицы в явно указанной тестовой БД. Подробности в runbook.

## API для нашего frontend

HTTP: `X-Auth-Token` и `X-Auth-U-Hash` текущего пользователя. Пара проверяется через Core `/user/authorized`; браузерный общий API-ключ не нужен. JSON payload не принимает credentials.

```text
POST /api/taxi/orders                          # create + Idempotency-Key
POST /api/taxi/core-orders/{coreId}/commands   # пользовательский intent
GET  /api/taxi/core-orders/{coreId}            # авторизованная проекция Core
GET  /api/taxi/drivers/{driverId}              # собственный snapshot водителя
GET  /api/commands/{instanceId}                # только инициатор команды
GET  /api/commands/by-key/taxi/{key}           # восстановить потерянный receipt
WS   /api/realtime/ws/taxi/core-order/{coreId}
```

WebSocket: первым сообщением `{"type":"auth","token":"…","u_hash":"…"}` в течение 10 секунд; credentials не помещаются в URL. Остальные generic snapshot/event/command endpoints сохранены для совместимости и используют локальный FSM id, а не Core id.

`202` означает принятие. Результат проверяется по receipt до `COMPLETED`/`FAILED`; `snapshot.sync.status=pending` блокирует действия. `error` требует сверки. `/health` — liveness, не доказательство доступности Core/Redis или успешного заказа.

Продакшен этой веткой не изменён. Инструкция готовит отдельный backend deployment; target acceptance выполняется после настройки реального хостинга и tenant.
