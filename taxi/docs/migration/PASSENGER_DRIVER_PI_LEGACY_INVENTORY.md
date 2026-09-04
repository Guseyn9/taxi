# Инвентаризация Passenger и Driver после подключения PI

## Текущее состояние

Passenger Web поднят на маршруте `/passenger-order`. Основные компоненты канала
используют `PassengerSurface`, `LegacyPassengerGateway` и
`LegacyPassengerChannelStoreAdapter`; прямых импортов Redux и старого API в
границе Passenger Channel нет.

Driver использует `DriverHudSurface`, `DriverListSurface`, `MapSurface` и
`DriverMapGateway`. Lifecycle-команды arrive, start, confirm boarding, finish и
cancel проходят через PI. При настроенном Command API шлюз отправляет intent и
ждёт completion; без него сохраняется legacy fallback.

## Инвентаризация зависимостей

| Место | Текущая зависимость | Готовый PI-контракт | Решение сейчас |
|---|---|---|---|
| Passenger order flow | `LegacyPassengerGateway` | Passenger Action/Surface | Оставить migration adapter до готовности пассажирского Command API |
| Passenger read model | `LegacyPassengerChannelStoreAdapter` | Passenger Surface/Snapshot | Оставить до появления полного Passenger Snapshot |
| Driver arrive/start/boarding/finish | `DriverMapGateway` | Driver Action + Command/Query/Realtime | Переведено |
| Driver cancel/interruption | прямой `API.cancelDrive` | `DriverMapGateway` + `cancel_requested` | Переведено в этой итерации |
| Driver accept DIRECT/VOTE/OFFER | `LegacyBackendGateway` | Нет подтверждённого набора intent и completion states | Не переносить, server/PI gap |
| Driver profile, car, geocoding and routing | `LegacyBackendGateway` | Соответствующих PI capabilities нет | Оставить как инфраструктурный migration adapter |
| Driver lists fallback | Redux polling | Driver Snapshot/Realtime | Оставить fallback до доступности серверного Driver Snapshot во всех окружениях |
| Driver mock mode | Локальные mock orders | Не серверный сценарий | Оставить отдельно от production PI transport |

## Оставшиеся gaps

1. Нужны нормативные Driver intents и completion states для принятия DIRECT,
   участия/выхода из VOTE и отправки OFFER.
2. Для полного удаления Redux polling серверный Driver Snapshot и Realtime должны
   быть доступны и настроены во всех целевых окружениях.
3. Passenger mutation gateway остаётся переходным адаптером до появления
   пассажирского Command API с теми же командами.
4. Command Completion использует `GET /api/commands/{instanceId}` при включённом
   `REACT_APP_FSM_COMMAND_STATUS_ENABLED=true`; Snapshot-based реализация
   сохранена как rollout/legacy fallback.

Новых публичных контрактов PI в рамках этой инвентаризации не вводилось.
