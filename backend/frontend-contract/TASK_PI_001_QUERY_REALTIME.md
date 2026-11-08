# TASK-PI-001: Query и Realtime

**Статус:** фронтовая часть существующих серверных контрактов реализована  
**Дата:** 2026-08-08

## Что реализовано

- первичная загрузка snapshot одного известного taxi/order через Query API;
- передача серверного `availableActions` в Platform Interface Runtime;
- получение начального snapshot и `entity.updated` через WebSocket;
- игнорирование heartbeat `ping`;
- reconnect с экспоненциальной задержкой;
- восстановление актуального состояния из snapshot после reconnect;
- остановка WebSocket и таймеров при завершении Runtime;
- нормализация HTTP-ошибок на границе Backend Adapter;
- автоматическое переключение между серверным и legacy Provider.

Весь доступ выполняется через `FsmOrderSnapshotTransport` и
`DomainApiSnapshotProvider`. Platform Channel не обращается к этим endpoint
напрямую.

## Настройка

Минимальная конфигурация:

```dotenv
REACT_APP_FSM_API_URL=https://fsm.example.test
REACT_APP_FSM_ORDER_ID=42
```

Дополнительные параметры:

```dotenv
REACT_APP_FSM_API_TOKEN=test-token
REACT_APP_FSM_WS_URL=wss://fsm.example.test
REACT_APP_FSM_WS_TOKEN_QUERY_PARAM=access_token
```

Последний параметр используется только при наличии gateway, который официально
принимает токен в query string. Текущая серверная реализация такого механизма не
содержит. Токен в React environment является публичным для пользователя сборки и
не подходит для production-секрета.

## Что пока не закрыто

TASK-PI-001 нельзя считать выполненной полностью по следующим внешним причинам:

1. На сервере отсутствует Command API для Driver-команд.
2. Query API отдаёт snapshot отдельного заказа, но не полный Driver Snapshot.
3. Требуется браузерно-совместимая схема авторизации WebSocket.
4. Для живого интеграционного прогона нужны URL, CORS и тестовые данные сервера.

После появления этих контрактов текущий Runtime, Surface и reconnect-механизм
сохраняются. Потребуется добавить командный transport и Driver projection, а затем
прогнать полный жизненный цикл на тестовом сервере.

## Локальная проверка

- 24 test suites, 110 tests — пройдены, включая сквозной тест
  Query/Realtime → Backend Adapter → Platform Runtime → Surface cleanup;
- TypeScript `--noEmit` — пройден;
- lint новых Platform Interface и Backend Adapter файлов — пройден;
- production build — собран;
- исходные `interaction-contract` и `map-channel` не изменены.

Живой серверный прогон не выполнялся: для него нужны адрес тестового FSM API,
совместимая браузерная авторизация и тестовый `orderId`.
