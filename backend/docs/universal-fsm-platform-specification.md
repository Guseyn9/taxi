# Universal FSM Platform

## Полная техническая спецификация

Версия документа: 1.2  
Соответствует ТЗ: версия 1.1  
Профиль реализации: FSM Platform 5.0.0  
Дата: 4 августа 2026 года

## 1. Назначение документа

Документ описывает Universal FSM Platform как платформу исполнения длительных
бизнес-процессов и одновременно фиксирует фактические возможности текущей
реализации 5.0.0.

Документ предназначен для:

- архитектурного аудита;
- проверки совместимости существующей системы;
- построения Compatibility Matrix;
- проведения Gap Analysis;
- оценки миграции;
- проектирования доменных пакетов и адаптеров;
- подготовки инфраструктуры;
- оценки эксплуатационной надёжности.

Чтение исходного кода для понимания публичных контрактов не требуется.

### 1.1. Статусы возможностей

| Статус | Значение |
|---|---|
| Реализовано | Возможность присутствует в текущем профиле и покрыта тестами |
| Частично | Работает только в указанном профиле или имеет известные ограничения |
| Экспериментально | Есть код или схема, но компонент не подключён к production composition root |
| Запланировано | Зафиксирован целевой контракт, реализация отсутствует |
| Не поддерживается | Возможность сознательно не входит в текущую модель |

### 1.2. Нормативная и фактическая части

Требования Universal FSM Platform и свойства конкретного persistence-профиля
разделены. Если нормативный контракт шире реализации 5.0.0, это отмечено как
Gap. Название технологии само по себе не считается гарантией надёжности.

### 1.3. Навигация

- Разделы 2-4: термины, принципы и компоненты.
- Разделы 5-6: Runtime, транзакции и Persistence.
- Разделы 7-13: DSL, API, Event, Guard, Effect и Scheduler.
- Разделы 14-19: Context, Provider, Registry, Adapter, UI, Outbox и Realtime.
- Разделы 20-21: Reliability, Recovery и инфраструктура.
- Разделы 22-25: домены, Compatibility Matrix, Gap Analysis и миграция.
- Разделы 26-32: эксплуатация, тесты, статусы, приёмка и NFR.
- Приложения A-D: конфигурация, запуск, проверка и итог совместимости.

### 1.4. Статус и связанные документы

Этот файл является единой нормативной спецификацией Platform. При
противоречии с README или Stage-отчётом приоритет имеет этот документ.

Детальные и практические материалы:

- `universal-fsm-platform-specification-tz.md` - исходные требования 1.1;
- `universal-fsm-platform-developer-guide.md` - пошаговое подключение домена;
- `universal-fsm-platform-specification-changelog.md` - изменения спецификации;
- `fsm-platform-lifecycle.md` - детальный transaction lifecycle;
- `fsm-platform-stage4.md` - контракт Outbox и realtime;
- `fsm-platform-stage3.md` - границы Runtime/Registry/SQL Core.

## 2. Термины

| Термин | Определение |
|---|---|
| Service | Домен или сервис, например `taxi` или `courier` |
| Process | Именованный способ интерпретации Trigger для Entity |
| Entity | Доменная сущность со своим состоянием |
| State | Текущее доменное состояние Entity |
| Instance | Долговечная задача Runtime в `server_fsm_instances`, а не копия доменного State |
| Trigger | Вход Runtime: команда, событие или таймер с именем и payload |
| FSM Action | Внутреннее имя действия, полученное доменным resolver |
| Transition | Декларация `service + entity_type + from_state + action -> to_state` |
| Guard | Чистая доменная проверка допустимости Transition |
| Effect | Локальное изменение после успешного Transition |
| Context | Согласованный доменный снимок, используемый resolver, Guard и Effect |
| Snapshot | Авторизованное read-представление текущего доменного состояния |
| Journal | Долговечный журнал входов, переходов или ошибок |
| Outbox | Долговечная очередь внешних эффектов после commit |
| Realtime Event | Долговечное уведомление об изменении Entity |
| Principal | Проверенная идентичность пользователя и набор его ролей |
| Provider | Реализация хранения и конкурентного доступа к Context |
| SQL Core | Атомарный механизм применения уже выбранного Transition |

## 3. Архитектурные принципы

### 3.1. Инварианты

1. Источником истины доменного состояния является доменная Entity, например
   `orders.status`, а не `server_fsm_instances.fsm_state`.
2. Instance хранит состояние исполнения задачи:
   `PENDING`, `PROCESSING`, `COMPLETED` или `FAILED`.
3. Внешний клиент передаёт доменную команду или Trigger, а не имя SQL Action.
4. Доменный `ProcessDef` преобразует Trigger в FSM Action.
5. Runtime не содержит правил Taxi, Courier или другого домена.
6. Worker является единственным владельцем Session, commit и rollback.
7. SQL Core не принимает бизнес-решений.
8. Guard работает с согласованным pre-transition Context.
9. Effect получает заново построенный post-transition Context.
10. Внешние вызовы не выполняются внутри доменной транзакции.
11. Внешний эффект записывается в Outbox в той же транзакции, что и State.
12. Realtime публикует только зафиксированные события.
13. Параллельные команды не перезаписывают друг друга.
14. Конкурентный Transition завершается `TRANSITION_CONFLICT`, если
    `expected_state` устарел.
15. UI получает бизнес-доступные команды через `availableActions`.

### 3.2. Стиль платформы

| Свойство | Текущий профиль |
|---|---|
| FSM Driven | Да |
| Event/Trigger Driven | Да, через долговечную очередь Instance |
| Declarative | Частично: Transition в SQL, Process/Guard/Effect в Python |
| Runtime | Stateless между задачами; состояние находится в БД |
| Single Source of Truth | Доменная таблица |
| Multi-domain | Да, явная регистрация доменов |
| Event sourcing | Нет |
| Workflow orchestration | Ограничено последовательным FSM |

## 4. Общая архитектура и компоненты

```text
Channel / UI / external API
          |
          | authenticated domain command
          v
Command Adapter
          |
          | append Trigger
          v
server_fsm_instances
          |
          | SELECT FOR UPDATE SKIP LOCKED
          v
FsmInstanceWorker
          |
          v
ProcessDef -> Context Builder -> Action Resolver
          |
          v
Transition Repository -> Guard Registry
          |
          v
SQL Core v2: conditional UPDATE + action log
          |
          v
Post-transition Context -> Effect Registry
          |
          +----> local domain changes
          +----> fsm_timers
          +----> core_outbox
          +----> realtime_events
          |
          v
Worker COMMIT
          |
          +----> Outbox Worker -> Core / external systems
          |
          +----> Realtime Publisher -> Memory or Redis -> WebSocket
                                                    |
                                                    v
                                            authorized Snapshot
```

### 4.1. Компоненты

| Компонент | Ответственность | Состояние | Масштабирование |
|---|---|---|---|
| Domain Adapter | Принять команду и записать Trigger | Частично: Python enqueue API, общего Command HTTP API нет | Горизонтально при общей БД |
| Instance Queue | Долговечно хранить Trigger | Реализовано в MySQL | Через row locking |
| Worker | Claim, Session, транзакция, retry зависших задач | Реализовано | Несколько экземпляров |
| Runtime | Выполнить универсальный pipeline | Реализовано | Stateless |
| Registry | Хранить Process, Guard, Effect, Snapshot и access policy | Реализовано, in-process | Копия в каждом процессе |
| Context Builder | Построить и заблокировать Context | Реализовано доменами | В границе транзакции |
| SQL Core | Атомарно применить Transition | Реализовано в MySQL ХП | Масштабируется с БД |
| Timer Worker | Выполнить due Timer | Экспериментально | Production-модель не завершена |
| Outbox Worker | Доставить внешний эффект после commit | Реализовано | Несколько экземпляров |
| Realtime Publisher | Опубликовать долговечное событие | Реализовано | Несколько экземпляров |
| Realtime Transport | Fanout клиентам | Memory или Redis | Redis для нескольких узлов |
| Snapshot Service | Авторизованное read-only представление | Реализовано | Горизонтально |
| Context Provider | Независимый storage-контракт | Запланировано; текущий код зависит от SQLAlchemy Session |

### 4.2. Границы зависимостей

Домен зависит от контрактов Runtime. Runtime не импортирует доменные пакеты.
Composition root явно регистрирует домены. SQL Core знает только bindings,
State, Action и Transition. UI и транспорт не входят в транзакционное ядро.

### 4.3. Матрица гарантий и границ ответственности

| Компонент | Гарантирует | Не гарантирует |
|---|---|---|
| Worker | Одну Session и transaction на Instance; lease claim; rollback при ошибке | HTTP delivery; глобальный порядок; retry любой business-ошибки |
| Runtime | Одинаковый pipeline Process -> Context -> Guard -> Transition -> Effect | Бизнес-решение; matching; цену; hierarchy/parallel workflow |
| Registry | Уникальную регистрацию и startup validation имён | Dynamic plugin discovery; hot reload Registry |
| Context Builder | Согласованный Context в текущей transaction | Технологическую независимость Provider в 5.0.0 |
| Guard | Проверку одного доменного правила до Transition | Внешний Effect; автоматическую композицию нескольких Guard |
| SQL Core | Атомарный CAS Transition и Action Log | Выбор бизнес-решения; commit/rollback; HTTP |
| Effect | Локальное изменение в той же transaction | Доставку внешнего вызова; несколько Effect на Transition |
| Outbox | At-least-once delivery, retry, lease recovery, durable intent | Exactly-once без idempotent receiver; бизнес-порядок между aggregate |
| Realtime journal | Атомарную запись с State и replay по `eventId` | Доставку push каждому клиенту |
| Redis realtime | Fanout между API nodes | Persistence, replay, источник истины |
| Snapshot Service | Authenticated, authorized, read-only current ViewModel | Хранимый recovery Snapshot; историческое состояние |
| Timer scaffold | Схему и базовую обработку due Timer в тестовом коде | Production scheduling, retry/stale recovery и SLA |

### 4.4. Почему именно так: ключевые архитектурные инварианты

#### Worker является единственным владельцем транзакции

Worker создаёт Session, начинает transaction и единолично выполняет commit или
rollback. Runtime, Repository, Guard и Effect используют переданную Session, но
не завершают её самостоятельно.

Причина: переход State, Action Log, локальный Effect, Timer, Outbox и Realtime
должны либо сохраниться вместе, либо вместе откатиться. Commit внутри отдельного
слоя разрушил бы эту границу и оставил частично выполненный процесс при ошибке
следующего шага.

#### Trigger отделён от FSM Action

Канал передаёт доменное намерение в виде Trigger, а ProcessDef преобразует его
во внутренний FSM Action.

Причина: внешний клиент не должен знать граф переходов и не должен иметь
возможность вызвать внутреннее действие напрямую. Такое разделение сохраняет
доменную семантику API, позволяет менять внутренний граф без изменения каналов
и удерживает авторизацию и валидацию перед выбором Action.

#### Effect выполняется после успешного Transition

Сначала Guard подтверждает допустимость операции, затем SQL Core атомарно
меняет State, после чего Effect получает post-transition Context. Commit всё
ещё не выполнен, поэтому ошибка локального Effect откатывает и Transition.

Причина: Effect должен работать только для действительно состоявшегося
перехода и видеть новое доменное состояние. Если выполнить его раньше,
побочное изменение может сохраниться или уйти наружу при отклонённом либо
конкурентно проигранном Transition. Внешние вызовы поэтому дополнительно
оформляются через transactional Outbox.

#### Snapshot является read-only представлением

Snapshot Builder читает текущее доменное состояние через read-only Session и
не выполняет flush, commit или mutating SQL.

Причина: Query API может вызываться часто, повторно и параллельно разными
каналами. Чтение не должно незаметно менять бизнес-процесс, захватывать владение
транзакцией или становиться альтернативной командной точкой входа. Все изменения
проходят через Command/Trigger pipeline.

#### SQL Core применяет решение, но не принимает его

Resolver и Guard принимают доменное решение на согласованном Context. SQL Core
получает уже выбранные expected State и Action, выполняет условный UPDATE,
записывает журнал и возвращает результат конфликта или успеха.

Причина: если SQL Core начнёт читать бизнес-данные и выбирать поведение, общий
движок станет зависеть от Taxi, Courier или другого домена. Разделение оставляет
Runtime универсальным, а SQL Core отвечает только за атомарность и конкурентную
безопасность применения решения.

## 5. Модель исполнения Runtime

### 5.1. Приём Trigger

Trigger имеет поля:

| Поле | Тип | Обязательно | Ограничение |
|---|---|---:|---|
| `trigger_type` | string | Да | Рекомендуются `command`, `event`, `timer` |
| `trigger_name` | string | Да | Доменное имя, не FSM Action |
| `payload` | JSON object | Нет | По умолчанию `{}` |

Каждый Trigger создаёт новую строку Instance. Две конкурентные команды для
одной Entity сохраняются отдельно. Дедупликация входных команд общей
платформой пока не выполняется.

### 5.2. Жизненный цикл Instance

```text
PENDING -> PROCESSING -> COMPLETED
                     \-> FAILED

PROCESSING -- lease expired --> PENDING
PROCESSING -- retry limit --> FAILED
```

`WAITING` зарезервирован схемой и startup validation, но активный Worker не
переводит Instance в этот статус.

### 5.3. Claim

Worker выбирает одну строку:

```sql
WHERE instance_status = 'PENDING'
ORDER BY id
LIMIT 1
FOR UPDATE SKIP LOCKED
```

Claim предотвращает одновременную обработку одного Instance несколькими
Worker. Порядок приблизительно FIFO по `id`; глобальный строгий порядок при
нескольких Worker не гарантируется.

### 5.4. Транзакционный pipeline

1. Worker открывает одну Session для одного Instance.
2. Instance переводится в `PROCESSING`.
3. Runtime получает Process по `(service, process_name)`.
4. Проверяется соответствие `entity_type`.
5. Context Builder читает Entity и выполняет `SELECT ... FOR UPDATE`.
6. Action Resolver переводит Trigger в FSM Action.
7. Transition Repository загружает Transition.
8. Guard проверяет pre-transition Context.
9. SQL Core применяет State через compare-and-set по `expected_state`.
10. Runtime заново строит Context.
11. Проверяется, что фактический State равен `to_state`.
12. Effect выполняет локальные изменения, Outbox или Timer.
13. Записывается realtime-событие Transition.
14. Instance переводится в `COMPLETED`.
15. Worker выполняет commit.

При исключении доменные изменения вложенной транзакции откатываются, а
Instance сохраняется как `FAILED` с `last_error`. Ошибка одной задачи не
откатывает другие задачи пакета.

### 5.5. Разрешение FSM Action

`ProcessDef` содержит ровно один источник Action:

- `initial_action` для простого процесса;
- `action_resolver(context, trigger)` для ветвления.

Одновременное или нулевое указание источников запрещено Registry.

Пример:

```text
Trigger(command, candidate_selected)
  -> taxi_order_lifecycle
  -> order_select_candidate
```

### 5.6. Поиск Transition

Ключ:

```text
service + entity_type + current_state + action_name
```

Transition содержит `to_state` и необязательные `guard`, `effect`, `timer`.
Неоднозначные переходы обнаруживаются startup validation.

### 5.7. Guard

Guard выполняется до смены State и возвращает:

```json
{"ok": true, "reason": null}
```

При `ok=false` Runtime завершает обработку ошибкой и State не меняется. Guard
не должен выполнять внешние вызовы или владеть транзакцией.

### 5.8. SQL Core

SQL Core получает уже выбранные:

- `service`;
- `entity_type`;
- `entity_id`;
- `action_name`;
- `expected_state`;
- `user_id`;
- `extra_id`.

Алгоритм:

1. Получить binding Entity к таблице и колонке State.
2. Проверить безопасные имена binding.
3. Найти Action и исходный State.
4. Найти scoped Transition.
5. Выполнить условный `UPDATE`.
6. При нуле обновлённых строк вернуть `TRANSITION_CONFLICT`.
7. Записать успешный Transition в `fsm_action_logs`.
8. Вернуть `OK`.

SQL Core не выполняет commit или rollback.

Коды:

| Код | Значение |
|---|---|
| `OK` | Transition применён |
| `UNKNOWN_ENTITY_TYPE` | Нет binding |
| `INVALID_ENTITY_BINDING` | Binding содержит недопустимое имя |
| `UNKNOWN_ACTION_OR_STATE` | Не найден Action или State |
| `INVALID_TRANSITION` | Переход не объявлен |
| `TRANSITION_CONFLICT` | State изменился или Entity отсутствует |
| `SQL_ERROR` | Ошибка SQL |

### 5.9. Effect

Effect выполняется после успешной смены State и получает post-transition
Context. Он может:

- изменить локальные доменные таблицы;
- создать Trip;
- создать Outbox event;
- запланировать Timer.

Effect не должен:

- создавать Session;
- выполнять commit или rollback;
- выполнять сетевой вызов;
- повторно менять основной State в обход Runtime.

Ошибка Effect приводит к rollback всей доменной транзакции, включая State,
Action Log, Outbox и realtime event.

### 5.10. Конкурентность

Используются два механизма:

- pessimistic locking в Context Builder для согласованного Context;
- optimistic compare-and-set в SQL Core для защиты применения решения.

Для одной Entity и двух команд с одинаковым `expected_state` не более одной
команды может успешно выполнить одинаковый Transition. Остальные получают
`TRANSITION_CONFLICT`.

Интеграционный тест с 50 Entity и двумя параллельными командами на каждую
подтверждает 50 `OK` и 50 `TRANSITION_CONFLICT`.

## 6. Модель данных и Persistence

### 6.1. Источники истины

| Данные | Источник истины |
|---|---|
| Доменный State | Колонка доменной Entity, например `orders.status` |
| Статус обработки | `server_fsm_instances.instance_status` |
| Граф FSM | `fsm_states`, `fsm_actions`, `fsm_transitions` |
| Binding Entity | `fsm_entity_bindings` |
| Журнал Transition | `fsm_action_logs` |
| Ошибка Instance | `server_fsm_instances.last_error` |
| Внешние эффекты | `core_outbox` |
| Realtime replay | `realtime_events` |
| Timer | `fsm_timers`, экспериментально |
| Taxi Candidate/Offer | `orders.metadata_json` в MVP |
| UI Snapshot | Не хранится, строится при чтении |

### 6.2. Основные таблицы

#### `fsm_states`

Справочник глобально уникальных имён State.

#### `fsm_actions`

Справочник глобально уникальных имён FSM Action.

#### `fsm_transitions`

| Поле | Тип | Назначение |
|---|---|---|
| `service` | varchar(50) | Scope домена |
| `entity_type` | varchar(50) | Scope Entity |
| `from_state_id` | FK | Исходный State |
| `action_id` | FK | FSM Action |
| `to_state_id` | FK | Целевой State |
| `guard_name` | varchar(100), nullable | Имя Guard в Registry |
| `guard_params` | JSON | Параметры Guard |
| `effect_name` | varchar(100), nullable | Имя Effect в Registry |
| `effect_params` | JSON | Параметры Effect |
| `timer_name` | varchar(100), nullable | Зарезервированная декларация Timer |
| `timer_params` | JSON | Параметры Timer |

Уникальность Transition задаётся по
`service, entity_type, from_state_id, action_id`.

#### `server_fsm_instances`

Долговечная append-only очередь Trigger и результат их обработки. Важные поля:
`service`, `process_name`, `instance_status`, Trigger, Entity, число попыток,
lease, результат и ошибка.

#### `fsm_action_logs`

Append-only журнал успешных Transition: Service, Entity, Action, from/to,
пользователь и время. Это аудит переходов, но не полноценный event store.

#### `fsm_errors_log`

Журнал ошибок SQL Core с Entity, Action, пользователем, временем и текстом
ошибки. Он не заменяет `server_fsm_instances.last_error`: ошибка, возникшая в
транзакции, может быть откачена вместе с ней, поэтому операционная диагностика
должна опираться также на Instance и централизованные process logs.

#### `core_outbox`

Долговечные внешние эффекты с уникальным `idempotency_key`, lease, retry,
ответом и ошибкой.

#### `realtime_events`

Долговечный журнал уведомлений, используемый для публикации и replay.

### 6.3. Миграции

Чистая установка:

1. `install_fsm_platform.sql`;
2. `003_fsm_platform.sql`;
3. доменные таблицы и seed;
4. `004_scope_domain_transitions.sql`;
5. `005_outbox_realtime.sql`.

Legacy-миграции идемпотентны. DDL не считается транзакционным: MySQL выполняет
неявный commit для `ALTER TABLE`.

### 6.4. Версионирование схемы

Номер версии миграции содержится в имени SQL-файла. Отдельной таблицы
`schema_migrations`, автоматического migrator и rollback-миграций в текущем
профиле нет. Это Gap для независимого production deployment.

## 7. Декларативная модель и DSL

### 7.1. Фактический DSL 5.0.0

Текущий DSL является составным:

1. Python `ProcessDef` описывает интерпретацию Trigger.
2. SQL-таблицы описывают State, Action и Transition.
3. Python Registry связывает имена Guard и Effect с функциями.
4. Domain `fsm_spec.py` является машинной спецификацией и источником seed.

Это не отдельный текстовый язык и не универсальный workflow DSL.

### 7.2. Process

| Поле | Тип | Обязательно | Правило |
|---|---|---:|---|
| `service` | string | Да | Непустое имя домена |
| `process_name` | string | Да | Уникально внутри Service |
| `entity_type` | string | Да | Должен иметь Context/Snapshot/access policy |
| `context_builder` | callable | Да | Работает с caller-owned Session |
| `initial_action` | string | Условно | Ровно одно из двух |
| `action_resolver` | callable | Условно | Ровно одно из двух |

### 7.3. State

State является строкой до 100 символов. Имена глобально уникальны в текущей
схеме. Рекомендуемый формат:

```text
<entity>_<business_state>
```

Примеры: `order_created`, `order_in_ride`, `locker_reserved`.

### 7.4. Action

FSM Action является внутренним строковым идентификатором до 100 символов.
Клиент не должен передавать его напрямую.

Рекомендуемый формат:

```text
<entity>_<verb>[_<object>]
```

### 7.5. Transition

Нормативная форма:

```json
{
  "service": "taxi",
  "entityType": "order",
  "from": "order_vote_waiting_candidates",
  "action": "order_select_candidate",
  "to": "order_vote_driver_assigned",
  "guard": {
    "name": "can_select_candidate",
    "params": {}
  },
  "effect": {
    "name": "create_trip",
    "params": {}
  },
  "timer": null
}
```

В текущей реализации один Transition поддерживает не более одного Guard,
одного Effect и одной Timer-декларации.

### 7.6. Поддерживаемые конструкции

| Конструкция | Статус | Комментарий |
|---|---|---|
| State | Реализовано | Плоский строковый State |
| Transition | Реализовано | Scoped по Service и Entity |
| Trigger | Реализовано | Command/Event/Timer envelope |
| FSM Action | Реализовано | Вычисляется Process |
| Guard | Реализовано | Один на Transition |
| Effect | Реализовано | Один на Transition |
| Entry/Exit Action | Не поддерживается | Можно моделировать Effect |
| Timeout | Экспериментально | Таблица и Worker scaffold |
| Retry | Частично | Worker stale retry и Outbox retry |
| Choice | Частично | Через Action Resolver до Transition |
| Fork/Join | Не поддерживается | Нет параллельных веток |
| Parallel State | Не поддерживается | Нет orthogonal regions |
| History State | Не поддерживается | Нет shallow/deep history |
| Hierarchy | Не поддерживается | Только плоский граф |
| Composite State | Не поддерживается | Только плоский граф |
| Nested FSM | Не поддерживается | Можно координировать доменным кодом |
| Saga | Не поддерживается | После MVP |
| Multiple Effects | Запланировано | Целевая таблица `fsm_transition_effects` |

### 7.7. Валидация DSL

При startup Registry проверяет:

- отсутствие незарегистрированных Guard;
- отсутствие незарегистрированных Effect;
- отсутствие неоднозначных Transition;
- регистрацию Process для активных Instance;
- наличие Snapshot Builder;
- наличие access policy.

Не проверяются автоматически:

- достижимость State;
- терминальность;
- циклы;
- полнота переходов;
- соответствие Python `fsm_spec.py` применённому seed;
- схема `guard_params` и `effect_params`.

## 8. Runtime API

### 8.1. Фактический command API

Публичного REST Command API в 5.0.0 нет. Внутренний адаптер вызывает
`enqueue_instance_trigger` или `enqueue_fsm_instance` в caller-owned Session.

Параметры enqueue:

| Параметр | Тип | Обязательно |
|---|---|---:|
| `service` | string | Да |
| `process_name` | string | Да |
| `entity_type` | string | Да |
| `entity_id` | integer | Да |
| `trigger` | Trigger | Да |
| `user_id` | integer | Нет |
| `user_role` | string | Нет |
| `target_user_id` | integer | Нет |
| `target_role` | string | Нет |
| `metadata` | object | Нет |

Функция не выполняет commit и возвращает идентификатор Instance.

### 8.2. Python Runtime API

#### `FsmEngine.run_action`

Синхронно выполняет один Transition в переданной Session. Возвращает
`FsmResult`. Не владеет транзакцией.

#### `FsmInstanceWorker.run_once`

Обрабатывает до `limit` Instance, по отдельной Session на каждый. Возвращает
`WorkerBatchResult`.

#### `SnapshotService.build`

Принимает Principal, Service, Entity и ID. Проверяет access policy и вызывает
Snapshot Builder через read-only Session.

### 8.3. HTTP read/realtime API

#### Health

```text
GET /health
```

Ответ:

```json
{"status": "ok", "realtime": "enabled"}
```

Текущий health endpoint не проверяет доступность БД, Redis, Outbox backlog или
Registry после startup.

#### Snapshot

```text
GET /api/realtime/snapshot/{service}/{entity_type}/{entity_id}
Authorization: Bearer <token>
```

Коды: `200`, `401`, `403`, `404`.

#### Replay

```text
GET /api/realtime/events/{service}/{entity_type}/{entity_id}?after=0&limit=100
Authorization: Bearer <token>
```

`after` не меньше нуля. `limit` от 1 до 500.

#### WebSocket

```text
WS /api/realtime/ws/{service}/{entity_type}/{entity_id}
Authorization: Bearer <token>
```

Сообщения:

```json
{"type": "snapshot", "snapshot": {}}
{"type": "entity.updated", "event": {}, "snapshot": {}}
{"type": "ping"}
```

Close codes: `4401` без аутентификации, `4403` без доступа, `4404` Entity не
найдена, `1011` внутренняя ошибка.

### 8.4. Сопоставление с целевым API

| Операция | Статус 5.0.0 | Фактический механизм |
|---|---|---|
| `start` | Частично | Enqueue creation Process |
| `dispatch` | Частично | Enqueue lifecycle Trigger |
| `resume` | Не реализовано как API | Stale recovery Worker |
| `cancel` | Доменная команда | Отдельный Trigger |
| `pause` | Не поддерживается | Нет состояния pause Instance |
| `complete` | Доменная команда | Transition конкретного домена |
| `restore` | Нет публичного API | Recovery за счёт БД и lease |
| `snapshot` | Реализовано | HTTP/Python SnapshotService |

## 9. Event Model

### 9.1. Типы входов

| Тип | Источник | Пример | Изменяет State напрямую |
|---|---|---|---:|
| Command Trigger | Пользователь/API | `candidate_selected` | Нет |
| Event Trigger | Система/Adapter | `driver_arrived` | Нет |
| Timer Trigger | Scheduler | `pickup_timeout` | Нет |
| FSM Action | ProcessDef | `order_select_candidate` | Через SQL Core |
| Transition Event | Runtime | `fsm.transition` | Нет |
| UI Event | Realtime API | `entity.updated` | Нет |

Command/Event преобразуется доменом в FSM Action. Runtime не должен выводить
FSM Action из произвольного `payload["action_name"]`.

### 9.2. Нормативный целевой Envelope Trigger

Следующий JSON описывает целевой внешний Command/Event contract, а не
текущую внутреннюю схему MySQL.

```json
{
  "triggerType": "command",
  "triggerName": "candidate_selected",
  "payload": {
    "candidateUserId": 205
  },
  "requestedByUserId": 100,
  "requestedUserRole": "client"
}
```

Текущая внутренняя сериализация 5.0.0 хранит имена полей в `snake_case`.
Версионирование envelope явно не реализовано. Для внешнего Command API
необходимо добавить `schemaVersion`, `commandId`, `correlationId`,
`causationId` и `idempotencyKey`.

### 9.3. Гарантии доставки

| Поток | Гарантия |
|---|---|
| Trigger -> Worker | At-least-once после commit enqueue; stale lease может привести к retry |
| Transition -> Outbox | Атомарная запись с доменным State |
| Outbox -> внешняя система | At-least-once |
| Transition -> realtime table | Атомарная запись с доменным State |
| realtime table -> Redis/Memory | At-least-once на уровне Publisher |
| Redis Pub/Sub -> подключённый клиент | Best effort |
| Replay из БД | Доступен по монотонному `eventId` |

WebSocket-клиент обязан уметь получать новый Snapshot и восстанавливать
пропущенные уведомления через replay. Redis не является журналом.

### 9.4. Порядок

Instance выбираются по `id`, realtime events по `id`, Outbox по
`created_at, id`. При нескольких Worker глобальный строгий порядок выполнения
не гарантируется. Для одной Entity корректность обеспечивается State и
`expected_state`, а не предположением о последовательной доставке.

Приоритеты Trigger в 5.0.0 не поддерживаются: в схеме нет поля priority, а
Worker использует FIFO по `id`. Если проект требует приоритеты, необходимо
добавить их в Instance contract, индекс claim и правила предотвращения
голодания низкоприоритетных задач.

### 9.5. Дедупликация и идемпотентность

- Trigger queue append-only и не имеет уникального `commandId`.
- SQL Core защищает State от повторного устаревшего Transition.
- Outbox требует глобально уникальный `idempotency_key`.
- HTTP Outbox передаёт его в `Idempotency-Key`.
- Внешний Core обязан дедуплицировать повтор.
- Realtime consumer должен переносить повторные события.

Отсутствие общего idempotency key для Command API является Gap.

### 9.6. Неизвестный вход

Неизвестный Trigger отклоняется Action Resolver. Неизвестный Process,
Guard или Effect отклоняется Registry. Ошибка сохраняется в Instance.
Dead-letter queue как отдельная сущность отсутствует; `FAILED` выполняет её
минимальную роль.

## 10. Action API

### 10.1. Контракт resolver

```text
resolve(context, trigger) -> action_name
```

Resolver:

- принадлежит доменному пакету;
- не выполняет commit;
- не изменяет Context;
- не выполняет внешние вызовы;
- возвращает зарегистрированное имя FSM Action либо ошибку.

### 10.2. Простой Process

Простой Process хранит `initial_action`. Trigger запускает одно фиксированное
действие. Этот режим подходит только когда смысл Process однозначен.

### 10.3. Сложный Process

Сложный Process использует resolver и может учитывать:

- имя Trigger;
- текущий State;
- поля доменного Context;
- параметры команды.

Выбор исполнителя, расчёт цены и matching strategy не являются обязанностью
универсального FSM Engine. Домен или внешний сервис формирует результат, а FSM
фиксирует допустимый Transition.

### 10.4. Ошибки

Resolver должен завершаться доменной ошибкой для:

- неизвестного Trigger;
- отсутствующего обязательного payload;
- несовместимого режима Entity;
- невозможности вывести FSM Action.

В текущем профиле часть resolver использует `ValueError`; унифицированной
иерархии доменных ошибок нет.

### 10.5. Дочерние FSM

Прямого API запуска дочерней FSM нет. Effect может добавить новый Instance, но
контракт parent-child, ожидание результата, отмена и компенсация отсутствуют.

## 11. Guard API

### 11.1. Контракт

```text
guard(session, pre_context, params) -> GuardResult
```

`GuardResult`:

| Поле | Тип | Назначение |
|---|---|---|
| `ok` | boolean | Разрешение Transition |
| `reason` | string/null | Причина отказа |

### 11.2. Требования

Guard должен:

- быть детерминированным относительно согласованного Context;
- не изменять State;
- не выполнять внешние вызовы;
- не создавать Session;
- не выполнять commit или rollback;
- возвращать бизнес-причину отказа.

Guard может читать дополнительные данные через caller-owned Session, но
необходимые строки должны входить в согласованный Context или блокироваться
доменным Context Builder.

### 11.3. Именование

Рекомендуется `can_<business_operation>`, например:

- `can_cancel_order`;
- `can_select_candidate`;
- `can_start_ride`.

### 11.4. Композиция

Один Transition поддерживает один `guard_name`. Логическая композиция возможна
внутри зарегистрированной функции. Декларативные `allOf`, `anyOf`, `not` не
реализованы.

## 12. Effect API

### 12.1. Контракт

```text
effect(session, post_context, params) -> EffectResult
```

`EffectResult`:

| Поле | Тип | Назначение |
|---|---|---|
| `ok` | boolean | Успех локального Effect |
| `message` | string/null | Диагностика |

### 12.2. Требования

Effect выполняется после SQL Core, но до commit Worker. Он должен быть
транзакционным относительно локальной БД.

Разрешено:

- создать/изменить связанную доменную Entity;
- записать Outbox;
- записать Timer;
- записать локальный аудит.

Запрещено:

- сетевой вызов;
- commit/rollback;
- создание Session;
- скрытая фоновая работа до commit.

### 12.3. Внешний эффект

Внешнее действие моделируется так:

```text
Effect -> INSERT core_outbox -> Worker COMMIT
       -> Outbox Worker -> external system
```

Это устраняет dual-write между State и запросом во внешнюю систему.

### 12.4. Несколько Effect

Текущий Transition содержит один `effect_name`. Целевая эволюция:

```text
fsm_transition_effects(
  transition_id,
  sequence,
  effect_name,
  effect_params
)
```

До её реализации сложный Effect может оркестрировать несколько локальных
операций, но это уменьшает декларативность.

## 13. Scheduler и Timer

### 13.1. Целевая модель

Timer должен быть долговечным и содержать:

- Service и Process;
- Entity;
- имя Timer;
- параметры;
- due time;
- Action/Trigger;
- статус;
- attempts;
- lease;
- результат ошибки.

### 13.2. Текущий статус

Таблица `fsm_timers`, функции schedule/cancel и `FsmTimerWorker` существуют,
но компонент помечен экспериментальным и не подключён к основному запуску.

Поддержано в scaffold:

- due time;
- `PENDING`, `PROCESSING`, `FIRED`, `FAILED`, `CANCELLED`;
- `FOR UPDATE SKIP LOCKED`;
- запуск Runtime через Timer Trigger.

Не завершено:

- отдельный production entrypoint/service;
- stale lease recovery;
- retry schedule;
- гарантия single fire;
- идемпотентность;
- cron;
- debounce;
- heartbeat;
- startup validation;
- метрики;
- нагрузочные тесты.

### 13.3. Семантика

Timer не должен напрямую решать, какой Taxi/Courier State установить. Он
создаёт доменный Trigger, а ProcessDef разрешает FSM Action.

После простоя due Timer должны обрабатываться после восстановления Scheduler.
Эта гарантия является целевой и не подтверждена текущим production runtime.

## 14. Context Model

### 14.1. Области

| Layer | Смысл | Mutable | Persistent в текущем профиле |
|---|---|---:|---:|
| Entity | State и основные поля процесса | Да | Да |
| Order/Trip/Locker | Доменный агрегат | Да | Да |
| User/Principal | Идентичность и роли | Нет в Runtime | Внешний auth/доменные таблицы |
| Instance | Вход и результат работы | Да | Да |
| UI | Snapshot и availableActions | Нет, производное | Нет |
| Calculated | Производные значения | Нет | Нет, если домен явно не сохраняет |
| Temporary | Данные текущего вызова | Да | Нет |
| Cache | Ускорение чтения | Да | Не является источником истины |

### 14.2. Жизненный цикл

1. Context Builder загружает Entity в начале Transition.
2. Pre-context живёт до применения SQL Core.
3. После смены State Context строится заново.
4. Post-context передаётся Effect.
5. После завершения Session объект Context не должен использоваться.

### 14.3. Mutable и immutable

Context dataclass является представлением данных, а не Unit of Work.
Изменения должны выполняться через Repository/Effect. Поля Principal и Trigger
считаются immutable. Payload следует считать недоверенным входом до доменной
валидации.

### 14.4. Scoping

Минимальный scope:

```text
service / entity_type / entity_id
```

Process добавляет `process_name`, но не меняет владельца State.

## 15. Context Provider

### 15.1. Нормативный контракт

Universal FSM Platform должна зависеть от Provider, а не от MySQL, Redis или
SQLAlchemy. Минимальный логический контракт:

```text
load(scope, entity_id) -> VersionedContext
create(scope, entity_id, context) -> VersionedContext
compare_and_set(scope, entity_id, expected_version, patch) -> VersionedContext
lock(scope, entity_id, lease) -> LockHandle
append_journal(entry) -> JournalId
begin_unit_of_work() -> UnitOfWork
health() -> ProviderHealth
capabilities() -> ProviderCapabilities
```

`UnitOfWork` обязан поддерживать commit/rollback либо сообщить, что выбранный
Process не совместим с Provider.

### 15.2. Обязательные capabilities

| Capability | Для production FSM |
|---|---:|
| Durable storage | Обязательно |
| Atomic state update | Обязательно |
| Compare-and-set/versioning | Обязательно |
| Transaction или эквивалентная атомарность | Обязательно |
| Journal append | Обязательно для аудита |
| Concurrent access | Обязательно |
| Health reporting | Обязательно |
| Snapshot storage | Опционально |
| TTL | Опционально |
| Distributed lock | Опционально при наличии CAS/DB locking |

Runtime должен прекращать startup, если Provider не поддерживает обязательные
возможности выбранного Process.

### 15.3. Ошибки Provider

| Ошибка | Семантика | Retry |
|---|---|---|
| `NotFound` | Entity отсутствует | Нет без создания |
| `Conflict` | Версия/State устарели | Только повтор команды с новым Context |
| `Unavailable` | Provider недоступен | Да с backoff |
| `Timeout` | Результат неизвестен | Проверить состояние перед retry |
| `SerializationError` | Некорректные данные | Нет, требуется исправление |
| `IntegrityError` | Нарушен инвариант | Нет автоматически |
| `UnsupportedCapability` | Профиль несовместим | Ошибка startup |

### 15.4. Фактический Provider 5.0.0

Отдельного интерфейса Provider нет. `ContextBuilder`, Guard, Effect и
Repository принимают `sqlalchemy.orm.Session`. Фактический профиль:

| Свойство | Реализация |
|---|---|
| Storage | MySQL 8, InnoDB |
| Driver | SQLAlchemy + mysql-connector |
| Transaction | SQLAlchemy Session |
| Pessimistic lock | `SELECT ... FOR UPDATE` |
| Optimistic lock | `expected_state` в ХП |
| Journal | MySQL tables |
| Realtime transport | Memory или Redis, не источник истины |

`ReadOnlySession` является защитой от случайной записи, а не security sandbox.
Proxy отклоняет известные mutating SQL-префиксы, ORM mutation, `flush` и
`commit`, но не является SQL parser и делегирует остальные атрибуты исходной
Session. Поэтому он не заменяет минимальные DB privileges, code review и тесты
Snapshot Builder. Недоверенный пользовательский код внутри процесса Platform
не поддерживается.

Отвязка Runtime contracts от SQLAlchemy является архитектурным Gap. До неё
нельзя заявлять технологическую независимость Context Provider как
реализованную возможность.

### 15.5. Профили Provider

| Provider | Возможный RPO | Производственный статус |
|---|---|---|
| In-memory | Полная потеря при остановке | Только development |
| Redis без persistence | Полная потеря | Не подходит как источник истины |
| Redis RDB | До последнего snapshot | Ограниченно, зависит от настроек |
| Redis AOF | Зависит от `appendfsync` и replication | После отдельной квалификации |
| MySQL/PostgreSQL | После подтверждённого commit при durable storage | Подходит при backup/replication |

Фактический RPO определяется конфигурацией fsync, диска, репликации и backup,
а не названием Provider.

## 16. Registry и расширение Platform

### 16.1. Registry

Registry хранит:

- Process;
- Guard;
- Effect;
- Snapshot Builder;
- Entity Access Policy.

Имена Guard и Effect являются контрактом между SQL declaration и доменным
кодом.

### 16.2. Регистрация доменов

Текущий composition root выполняет явную регистрацию Courier и Taxi.
Это целевая модель для небольшого числа доменов: она прозрачна и проверяема.

Подключение домена требует:

1. Domain package.
2. Process registration.
3. Context Builder.
4. Action Resolver.
5. Guard/Effect.
6. Snapshot Builder.
7. Access Policy.
8. Entity binding.
9. State/Action/Transition seed.
10. Интеграционные тесты.

### 16.3. Plugin discovery

Динамический discovery не реализован и пока не требуется. Решение следует
пересмотреть после подключения третьего домена, например GreenMarket.

Domain и Plugin не являются синонимами. Домены могут регистрироваться явно,
а инфраструктурные расширения могут использовать Plugin API.

### 16.4. Повторяющиеся доменные компоненты

Taxi и Courier повторяют структуру Security, Snapshot, Repository и Process.
До появления устойчивого третьего примера вводить глубокую иерархию не
рекомендуется. Допустимы небольшие композиционные helpers без наследования
доменной логики.

### 16.5. Нормативный Plugin API

Динамический Plugin API является запланированным расширением и не должен
подменять явную регистрацию домена.

Минимальный manifest:

```json
{
  "name": "geo-postgis",
  "version": "1.2.0",
  "platformApi": "1",
  "capabilities": ["geo"],
  "entrypoint": "package.module:plugin"
}
```

Целевой контракт:

```text
validate(platform_capabilities) -> ValidationResult
register(registry) -> None
start(runtime_services) -> None
stop() -> None
health() -> PluginHealth
```

Правила:

- имя Plugin уникально;
- major-версия `platformApi` должна совпадать;
- регистрация выполняется до startup validation;
- `start` выполняется только после успешной валидации;
- Plugin не получает право выполнять commit/rollback доменной Session;
- конфликт имён Guard/Effect/Adapter является ошибкой startup;
- сбой обязательного Plugin блокирует readiness;
- optional Plugin может быть отключён только если Process не требует его
  capability.

Категории:

| Capability | Назначение | Предпочтительный контракт |
|---|---|---|
| Geo | Геокодирование, расстояния, зоны | Domain service/Adapter |
| Voice | STT/TTS | External Effect + Outbox |
| Map | Маршруты и визуализация | Query/External Adapter |
| Network | HTTP/MQ transport | Transport Adapter |
| Storage | Context/Persistence | Context Provider |
| External Event | Входящие webhook/message | Event Adapter |
| Notification | Push/SMS/WhatsApp | Outbox Handler |
| Custom Validation | Доменные проверки | Guard registration |

В 5.0.0 manifest, discovery и lifecycle Plugin не реализованы.

## 17. Adapter API

### 17.1. Типы Adapter

| Adapter | Направление | Текущий статус |
|---|---|---|
| Command Adapter | Channel -> Trigger queue | Частично, Python enqueue |
| Context Adapter | Provider -> Domain Context | Реализован как Context Builder для MySQL |
| Core Adapter | Domain -> iBronevik/Core | Частично, legacy facade и HTTP Outbox |
| Event Adapter | External event -> Trigger | Доменный resolver, общего transport API нет |
| Storage Adapter | Runtime -> Provider | Запланирован |
| UI Adapter | Snapshot/realtime -> UI | Реализован read/realtime API |
| Auth Adapter | Host/Bearer -> Principal | Реализован |

### 17.2. Core Adapter

Целевая модель:

```text
Domain Effect -> Outbox command -> Core Adapter -> external Core
```

HTTP Outbox payload:

```json
{
  "method": "POST",
  "path": "/orders/123/performer",
  "body": {
    "userId": 205,
    "performer": 1
  },
  "headers": {}
}
```

Handler добавляет `Content-Type`, `Idempotency-Key` и при настройке Bearer
token. Точные endpoints и payload внешнего Core являются deployment/domain
contract, а не частью универсального Engine.

Legacy Taxi/Courier facade с прямыми вызовами остаётся миграционным мостом.
Полный перевод внешних действий на Outbox не завершён.

### 17.3. Требования к Adapter

Каждый Adapter должен определить:

- schema version;
- timeout;
- retry;
- idempotency;
- mapping ошибок;
- authentication;
- correlation ID;
- ownership транзакции;
- observability;
- поведение при недоступности внешней системы.

## 18. UI Integration и Security

### 18.1. UI-модель

UI не является владельцем жизненного цикла заказа. Он получает:

- текущий доменный State;
- данные Entity;
- роль-зависимый Snapshot;
- `availableActions`;
- realtime notification.

UI отправляет доменную команду, но не выбирает FSM Transition самостоятельно.

### 18.2. Snapshot

Snapshot является Query-представлением и строится при чтении. Snapshot Builder:

- зарегистрирован по `(service, entity_type)`;
- получает Principal;
- работает через `ReadOnlySession`;
- не может выполнять mutating SQL, flush, commit или ORM mutation;
- фильтрует данные по роли.

Это defensive ограничение против случайной записи, а не изолирующий sandbox.
Production read-side дополнительно ограничивается правами DB и доверенной
регистрацией Snapshot Builder.

Taxi Driver видит только собственный Candidate/Offer. Client, Passenger,
Admin и System имеют расширенное представление. Полный metadata доступен
только Admin/System.

### 18.3. availableActions

Taxi вычисляет действия по State и роли в доменном коде. Courier временно
читает legacy `button_states` через доменный wrapper.

`availableActions` является presentation contract, производным от доменных
правил. Клиент не должен считать наличие кнопки единственной проверкой:
Runtime повторно выполняет Guard и Transition validation.

### 18.4. Principal

```json
{
  "userId": 205,
  "roles": ["driver"],
  "subject": "driver-205"
}
```

Поддержаны:

- доверенный Principal от host middleware;
- Bearer API keys из server-side `FSM_API_KEYS_JSON`.

Роль не принимается из query parameter или payload клиента.

### 18.5. Авторизация Entity

Перед Snapshot, replay и WebSocket Registry вызывает доменную access policy.
Admin/System имеют привилегированный доступ. Taxi проверяет клиента,
исполнителя, Candidate и Offer. Courier проверяет назначенного курьера,
водителя Trip или резерв пользователя Locker.

### 18.6. Ограничения security-профиля

- API key provider предназначен для MVP, не для полного IAM.
- Нет refresh/revocation protocol, OAuth/OIDC и rotation API.
- Нет rate limiting.
- Нет tenant isolation.
- Нет field-level policy framework, фильтрация выполняется доменом.
- Нет audit log успешной/неуспешной авторизации.
- WebSocket использует Bearer header, browser deployment может потребовать
  отдельный handshake token.

### 18.7. UI contract

| Понятие UI | Представление Platform |
|---|---|
| ViewModel | Snapshot |
| State | Поле `state` Snapshot |
| Commands | `availableActions` |
| Events | `entity.updated` |
| Subscription | WebSocket Entity channel |
| Initial binding | Первое сообщение `snapshot` |
| Reconnect | Новый Snapshot + replay after last eventId |
| Authorization | Principal + Entity access policy |

UI binding должен быть однонаправленным:

```text
Snapshot -> render
availableActions -> controls
user intent -> domain command
realtime event -> refresh Snapshot
```

Канал не хранит собственную копию доменного FSM. Локальный UI state
допускается только для формы, навигации и optimistic presentation, но не как
источник бизнес-State.

## 19. Outbox и Realtime

### 19.1. Transactional Outbox

Outbox event записывается внутри доменной транзакции. Уникальный
`idempotency_key` предотвращает создание дубликата записи.

Статусы:

```text
PENDING -> PROCESSING -> SENT
                     \-> RETRY -> PROCESSING
                     \-> FAILED
```

Claim выполняется отдельной короткой транзакцией. Сетевой вызов выполняется
после commit claim и без открытой Session. Результат фиксируется третьей
транзакцией.

### 19.2. Retry

По умолчанию:

- max attempts: 8;
- base delay: 5 секунд;
- exponential backoff;
- максимальная задержка: 300 секунд;
- processing lease: 300 секунд.

Если процесс упал после успешного HTTP и до `SENT`, запрос будет повторён.
Гарантия exactly-once достигается только совместно с идемпотентным внешним
получателем.

### 19.3. Realtime journal

`realtime_events` записывается в одной транзакции со State. Publisher
захватывает событие и публикует его через transport.

Статусы:

```text
PENDING -> PROCESSING -> PUBLISHED
                     \-> RETRY
```

Зависший `PROCESSING` возвращается в `RETRY`.

### 19.4. Transport

| Transport | Назначение | Durability |
|---|---|---|
| InMemory | Один API process | Нет |
| Redis Pub/Sub | Несколько процессов/узлов | Нет |
| MySQL realtime journal | Replay | Да |

Потеря Redis не приводит к потере доменного State или журнала. Подключённые
клиенты могут пропустить push и должны восстановиться через Snapshot/replay.

### 19.5. Backpressure

InMemory и Redis subscriber queue имеют ограниченный размер. При переполнении
удаляется старейшее сообщение. Это допустимо только потому, что UI всегда
получает актуальный Snapshot и может вызвать replay.

## 20. Надёжность и восстановление

### 20.1. Классы данных

| Данные | Хранилище 5.0.0 | Persistent | Journal | Snapshot | Источник истины |
|---|---|---:|---:|---:|---|
| Доменный State | MySQL domain table | Да | Transition log | Query only | Domain Entity |
| Instance/Trigger | MySQL | Да | Сама append-only запись | Нет | Instance table |
| Context | MySQL domain tables | Да | Частично | Query only | Domain Entity |
| Transition | MySQL | Да | `fsm_action_logs` | Нет | Domain Entity + log |
| Error | MySQL Instance/error log | Да | Да | Нет | Instance/error log |
| Outbox | MySQL | Да | Да | Нет | Outbox |
| Realtime event | MySQL | Да | Да | Нет | Realtime table |
| Redis message | Redis Pub/Sub | Нет | Нет | Нет | Не источник истины |
| InMemory message | RAM | Нет | Нет | Нет | Не источник истины |
| Timer | MySQL | Да | Частично | Нет | Timer table, экспериментально |
| UI Snapshot | Вычисляется | Нет | Нет | Нет | Domain Entity |

### 20.2. Recovery Point

В базовом MySQL-профиле логическая точка восстановления:

```text
последняя успешно зафиксированная транзакция Worker
```

В неё входят State, Action Log, локальные Effect, Outbox, Realtime Event и
статус Instance.

Незавершённая транзакция после crash откатывается InnoDB. Фактический RPO
после потери узла зависит от `innodb_flush_log_at_trx_commit`, storage,
репликации и backup.

### 20.3. Transaction Model

#### Локальные операции

Если Action 1, Action 2 и Action 3 входят в одну доменную транзакцию и Action 3
завершается ошибкой, Worker выполняет rollback всех трёх.

#### Внешние операции

Внешний HTTP не входит в ACID-транзакцию. Его intent фиксируется Outbox.
Возможен повтор после неопределённого результата, поэтому обязательна
идемпотентность.

#### Несколько бизнес-шагов

Если шаги были зафиксированы разными транзакциями, поздняя ошибка не
откатывает историю. Нужен новый Transition или compensation. Общий
compensation/saga framework не реализован.

### 20.4. Recovery Model

| Сбой | Что происходит | Автовосстановление | Потеря committed State |
|---|---|---:|---:|
| Runtime/Worker crash до commit | Транзакция откатывается, lease устаревает | Да, Instance возвращается в PENDING | Нет |
| Worker crash после commit | Instance и State уже зафиксированы | Да | Нет |
| Outbox crash до HTTP | PROCESSING lease истекает, повтор | Да | Нет |
| Outbox crash после HTTP до SENT | Возможен повтор HTTP | Да при идемпотентном Core | Нет |
| Realtime Publisher crash | Event остаётся/возвращается в RETRY | Да | Нет |
| Redis restart | WebSocket push прерывается | Snapshot/replay после reconnect | Нет |
| DB временно недоступна | Новые Transition не выполняются | После восстановления DB и процессов | Нет при durable DB |
| DB crash во время транзакции | InnoDB recovery | Зависит от DB profile | Не должна при durable commit |
| Scheduler crash | Due Timer остаются в таблице | Целевая гарантия, production Worker не завершён | Нет для записанных Timer |
| Power loss приложения | Аналогично crash процессов | Да после restart | Нет при сохранной DB |
| Network split App-DB | Транзакция успешна или откатывается; timeout может быть неопределённым | Проверка DB state перед retry | Зависит от DB outcome |
| Network split App-Core | Outbox retry | Да при idempotency | Нет |
| Потеря primary DB | Failover/restore вне Platform | Зависит от инфраструктуры | Зависит от replication/backup |

### 20.5. Stale recovery

Worker хранит `locked_at`, `locked_by`, attempts и timeout. Просроченный
`PROCESSING`:

- возвращается в `PENDING`, если retry limit не исчерпан;
- переводится в `FAILED`, если limit исчерпан.

Outbox и Realtime имеют аналогичную lease recovery. Timer Worker пока не имеет
полного stale recovery.

### 20.6. Consistency Model

| Граница | Модель |
|---|---|
| State + local Effect + logs + Outbox + realtime row | Strong consistency в одной MySQL transaction |
| Параллельные Transition | Pessimistic Context lock + optimistic CAS |
| External Core | Eventual consistency через Outbox |
| WebSocket UI | Eventual, Snapshot является актуальным read |
| Redis | Best-effort fanout |
| Replay | Монотонный ID, не event-sourced rebuild |

### 20.7. Event Journal и Replay

Имеются:

- входящие Trigger в Instance;
- успешные Transition в Action Log;
- Instance errors;
- Outbox attempts;
- Realtime events.

Полноценного единого event journal нет. Replay endpoint повторно выдаёт
уведомления UI, но не пересобирает доменный State. Event-sourcing и
deterministic replay FSM не поддерживаются.

### 20.8. Snapshot Strategy

Текущий Snapshot:

- строится по запросу;
- не сохраняется отдельно;
- не имеет версии схемы;
- не используется для восстановления State;
- фильтруется по Principal.

Для длительных процессов отдельное snapshot storage требуется только если
выбран event-sourced Provider или чтение текущего агрегата становится
неприемлемым. Это не требование текущего MySQL state-store.

### 20.9. High Availability

Поддержано:

- несколько Fsm Worker через `SKIP LOCKED`;
- несколько Outbox Worker;
- несколько Realtime Publisher;
- несколько Domain API при Redis transport;
- восстановление stale leases.

Не реализовано:

- автоматический DB failover внутри Platform;
- leader election;
- multi-region routing;
- quorum Context Provider;
- автоматическое DR;
- zero-downtime schema migration protocol.

Leader election не нужен для обычного Worker claim. Для singleton maintenance
задач при необходимости потребуется отдельный lease.

### 20.10. Disaster Recovery

Нормативный порядок:

1. Остановить Command ingress и Worker.
2. Восстановить MySQL schema и данные из backup/PITR.
3. Проверить целостность domain State, bindings, Instance, Outbox и logs.
4. Применить недостающие идемпотентные migrations.
5. Запустить Registry validation.
6. Восстановить `PROCESSING` leases по timeout.
7. Запустить FSM Worker.
8. Запустить Outbox Worker.
9. Запустить Realtime API/Publisher и Redis.
10. Проверить backlog, failed entries и контрольные Snapshot.
11. Открыть ingress.

Автоматизированный backup/PITR и DR runbook не входят в репозиторий. До
production необходимо определить периодичность backup, retention,
replication, владельца восстановления и регулярный DR test.

### 20.11. Reliability Matrix

| Сбой | Потеря состояния | Автовосстановление | RPO | Ожидаемый RTO | Требуется вмешательство |
|---|---|---:|---|---|---:|
| Runtime restart | Committed State не теряется; in-flight transaction откатывается | Да | Последний durable DB commit | Restart + stale timeout | Нет |
| Redis restart | Могут быть потеряны push-сообщения; State и DB journal не теряются | Да, reconnect + Snapshot/replay | Последний DB commit | Redis restart + reconnect | Обычно нет |
| DB restart | Uncommitted transaction теряется; committed State зависит от durability profile | После DB recovery | Последний durable commit | Не измерен | При нештатном recovery |
| Outbox Worker restart | Outbox intent не теряется; возможен повтор HTTP | Да | Последний Outbox commit | Restart + poll/lease timeout | Нет при idempotent receiver |
| Scheduler restart | Записанные Timer сохраняются; время срабатывания пропускается | Частично | Последний Timer commit | Не подтверждён | Возможно |
| Power failure App | Как при Runtime restart | Да | Последний durable DB commit | Время restart + stale timeout | Нет |
| Network split App-DB/Core | Зависит от неопределённого DB/Core outcome; возможен повтор | Retry + CAS/idempotency | Последний подтверждённый commit | Не измерен | При terminal/ambiguous failures |
| Потеря DB site | Зависит от replica, backup и PITR | Вне Platform | Зависит от DR profile | Не определён | Да |

Численные SLA, RPO и RTO не заявлены, поскольку production topology и
результаты failover-тестов не определены.

## 21. Инфраструктурные профили

### 21.1. Development

| Компонент | Требование |
|---|---|
| App | Один процесс |
| DB | Локальный MySQL 8 |
| Realtime | InMemory |
| Redis | Не обязателен |
| Backup | Не обязателен |
| Auth | Тестовые API keys |
| RPO/RTO | Не гарантируются |

### 21.2. Test

| Компонент | Требование |
|---|---|
| App | Worker, API, Outbox |
| DB | Изолированный MySQL 8 |
| Realtime | Redis 7 |
| Tests | Unit + integration + concurrency |
| Data | Синтетические |
| Reset | Полная очистка между наборами |

### 21.3. Demo

- Один DB instance с регулярным backup.
- Один или несколько App process.
- Redis при нескольких API.
- Непроизводственные credentials.
- Мониторинг процесса и backlog.
- Допускается ручное восстановление.

### 21.4. Production

Обязательно:

- durable MySQL/InnoDB storage;
- backup и проверяемый restore;
- репликация или managed HA;
- отдельные Worker/API/Outbox process;
- Redis HA для multi-node realtime;
- внешний IAM или защищённый auth middleware;
- TLS;
- secret manager;
- централизованные logs;
- метрики backlog, failures, lease age и latency;
- alerting;
- capacity limits;
- schema migration pipeline;
- утверждённые RPO/RTO;
- idempotent external Core.

### 21.5. High Availability

Дополнительно:

- минимум два экземпляра Worker, Outbox и Domain API;
- DB automatic failover;
- Redis replication/Sentinel/managed equivalent;
- load balancer с WebSocket;
- health/readiness probes;
- rolling deployment;
- tested failover;
- PITR;
- DR site или утверждённая backup strategy.

Platform не навязывает vendor, но production профиль обязан удовлетворять
capabilities и заявленным RPO/RTO.

## 22. Доменные профили

### 22.1. Taxi

Entity: `order`; отдельная доменная таблица `taxi_trips`.

Режимы:

- DIRECT;
- VOTE;
- OFFER.

State:

1. `order_created`
2. `order_vote_waiting_candidates`
3. `order_vote_driver_assigned`
4. `order_vote_no_show`
5. `order_driver_assigned`
6. `order_driver_arrived`
7. `order_in_ride`
8. `order_completed`
9. `order_cancelled`
10. `order_expired`
11. `ride_interrupted`
12. `order_offer_waiting`

Особенности:

- CandidateAdded и OfferAdded меняют `metadata_json`, но не State;
- expire применяется только до назначения;
- no-show terminal используется для VOTE;
- DIRECT/OFFER pickup problem в MVP завершается cancel;
- отмена разрешена до начала поездки;
- Trip создаётся Effect после назначения;
- boarding является Guard/Effect, не отдельной Entity;
- re-matching после MVP; возврат в ожидание моделируется обычным Transition.

Taxi Guards: cancel, select Candidate, start Ride. Taxi Effects: create/start/
finish Trip, Outbox, экспериментальный pickup Timer.

### 22.2. Courier

Entity:

- order;
- trip;
- locker.

Граф содержит отдельные State и Transition для резервирования постаматов,
назначения двух курьеров, перемещения посылки, Trip и Locker.

Текущий статус:

- машинная спецификация и seed присутствуют;
- Context/Repository/Snapshot/Access Policy подключены;
- legacy `button_states` остаётся источником availableActions;
- доменные Guards и Effects в основном не перенесены;
- авторитетный legacy-граф должен быть окончательно утверждён;
- `CourierActionsFacade` остаётся миграционным мостом.

### 22.3. Новый домен

GreenMarket или другой домен должен подключаться без изменения Runtime:

```text
domains/greenmarket/
  models
  repositories
  context
  processes
  guards
  effects
  query_api
  security
  fsm_spec
  sql seed
```

Третий домен используется как критерий необходимости plugin discovery и
выделения повторяемых инфраструктурных helpers.

## 23. Compatibility Matrix

### 23.1. Фактическая матрица Platform 5.0.0

Риск и оценка ниже являются предварительными для самой Platform. При анализе
конкретного проекта они уточняются по шаблону 23.2. Шкала трудоёмкости:
`S` - конфигурация, `M` - ограниченная доработка, `L` - новая подсистема, `XL` -
изменение модели Runtime.

| Критерий | Возможность Platform | Соответствие | Миграционное действие | Риск | Оценка |
|---|---|---|---|---|---|
| Плоский FSM | State/Action/Transition | Полное | Конвертировать граф | Низкий | S |
| Длительный процесс | Durable Instance и domain State | Полное | Настроить Process | Низкий | S |
| Несколько доменов | Явный Registry | Полное | Добавить domain package | Низкий | M |
| Guard | Python Registry, один на Transition | Частичное | Перенести правила | Средний | M |
| Effect | Python Registry, один на Transition | Частичное | Разделить local/external | Средний | M |
| Таймер | Experimental scaffold | Частичное | Завершить Timer Runtime | Высокий | L |
| Retry команды | Stale retry | Частичное | Добавить policy/idempotency | Средний | M |
| Outbox | At-least-once | Полное | Сделать Core идемпотентным | Средний | M |
| Realtime | DB journal + Memory/Redis | Полное | Подключить transport | Низкий | S |
| Snapshot | Role-aware query | Полное | Реализовать builder/policy | Средний | M |
| availableActions | Domain resolver | Полное | Описать по State/role | Низкий | S |
| Иерархический FSM | Нет | Отсутствует | Flatten или расширить DSL | Высокий | XL |
| Parallel/fork/join | Нет | Отсутствует | Оркестрация или новый Runtime | Высокий | XL |
| Saga/compensation | Нет framework | Отсутствует | Доменная реализация | Высокий | L |
| Event sourcing | Нет | Не требуется базовой моделью | Adapter/новый Provider | Высокий | XL |
| Storage-neutral Provider | Целевой контракт, фактически SQLAlchemy | Частичное | Ввести Provider/UoW API | Высокий | L |
| Command REST API | Нет | Отсутствует | Реализовать transport adapter | Средний | M |
| Multi-worker | `SKIP LOCKED` | Полное для MySQL | Capacity test | Средний | M |
| Optimistic concurrency | `expected_state` | Полное | Сопоставить version semantics | Низкий | S |
| HA App | Поддерживается | Частичное | Настроить DB/Redis HA | Высокий | L |
| DR | Runbook описан, automation нет | Частичное | Backup/PITR/failover tests | Высокий | L |
| Observability | Logs и DB statuses | Частичное | Метрики/tracing/alerts | Средний | M |
| IAM | Principal + MVP API keys | Частичное | Интегрировать production IAM | Средний | M |

### 23.2. Шаблон сравнения проекта

Для каждого проекта заполняется:

| Область | Требование проекта | Platform | Статус | Adapter/доработка | Риск | Оценка |
|---|---|---|---|---|---|---|
| FSM constructs |  |  | Full/Partial/None |  |  |  |
| Context |  |  |  |  |  |  |
| Commands/Events |  |  |  |  |  |  |
| Timers |  |  |  |  |  |  |
| External effects |  |  |  |  |  |  |
| UI/realtime |  |  |  |  |  |  |
| Security |  |  |  |  |  |  |
| Persistence |  |  |  |  |  |  |
| RPO |  |  |  |  |  |  |
| RTO |  |  |  |  |  |  |
| HA/DR |  |  |  |  |  |  |
| Operations |  |  |  |  |  |  |

### 23.3. Критерии блокирующей несовместимости

Миграция не может считаться прямой, если исходная система требует:

- обязательный hierarchy/parallel workflow;
- exactly-once external side effects без идемпотентного получателя;
- storage Provider без транзакций/CAS;
- multi-region active-active с конфликтным State;
- event-sourced rebuild;
- production Timer до завершения Timer Runtime;
- численное SLA, не подтверждённое инфраструктурой и тестами.

## 24. Методика Gap Analysis

### 24.1. Этапы

1. Инвентаризировать процессы, Entity и владельцев State.
2. Выделить Commands, Events, Timer и внешние эффекты.
3. Экспортировать граф State/Transition.
4. Классифицировать Guard и Effect.
5. Определить transaction boundaries.
6. Описать Context и источник истины.
7. Зафиксировать delivery guarantees.
8. Зафиксировать RPO/RTO и failure model.
9. Заполнить Compatibility Matrix.
10. Оценить adapters, converters и domain code.
11. Построить план миграции и rollback.

### 24.2. Карточка Gap

```text
ID:
Область:
Требование исходной системы:
Возможность Platform:
Статус: Full / Partial / None
Причина:
Предлагаемое решение:
Затрагиваемые компоненты:
Риск:
Тест приёмки:
Оценка:
Владелец:
```

### 24.3. Категории оценки

| Статус | Значение |
|---|---|
| Full | Перенос конфигурации/графа без изменения Runtime |
| Partial | Нужен Adapter или ограниченная доработка |
| None | Нужна новая capability или изменение архитектуры |

### 24.4. Оценка миграции

Трудоёмкость должна разделяться на:

- domain model;
- graph conversion;
- Context/Repository;
- Guard;
- Effect/Outbox;
- API/transport;
- UI resolver;
- data migration;
- reliability/infrastructure;
- testing/stabilization.

## 25. План миграции существующей системы

### 25.1. Стратегия

Рекомендуется постепенная миграция:

```text
legacy behavior
  -> domain package and repositories
  -> Context Builder
  -> ProcessDef/resolver
  -> machine FSM spec and seed
  -> Guards
  -> local Effects
  -> external Effects through Outbox
  -> Snapshot/availableActions
  -> command adapter
  -> disable legacy direct transition path
```

### 25.2. Данные

Для каждой legacy Entity требуется mapping:

- legacy ID -> Platform Entity ID;
- legacy State -> canonical State;
- legacy action/event -> Trigger/FSM Action;
- legacy JSON -> Context fields;
- actor -> Principal;
- external ID -> mapping table.

### 25.3. Dual-run

Если применяется параллельный запуск:

- только одна система должна владеть записью State;
- вторая работает в shadow/read-only;
- результаты сравниваются;
- запрещён dual-write без Outbox/idempotency;
- переключение имеет rollback plan.

### 25.4. Cutover

1. Остановить legacy writes.
2. Дождаться или заморозить in-flight operations.
3. Выполнить final data sync.
4. Проверить State mapping и Registry.
5. Запустить Worker/Outbox/API.
6. Выполнить smoke transitions.
7. Переключить ingress.
8. Наблюдать backlog/errors.
9. Сохранить rollback window.

## 26. Observability и эксплуатация

### 26.1. Фактические сигналы

- process logs;
- Instance status/attempts/error;
- Action Log;
- Outbox status/attempts/error;
- Realtime status/attempts/error;
- `/health`.

### 26.2. Обязательные production-метрики

| Метрика | Назначение |
|---|---|
| Pending Instance count/age | Очередь FSM |
| Processing lease age | Зависшие Worker |
| Transition latency | Производительность Runtime |
| Transition conflicts | Конкурентность/повторы |
| Guard rejects | Бизнес-отказы |
| Failed Instance | Ошибки домена/инфраструктуры |
| Outbox pending/retry/failed | Состояние Core integration |
| Outbox delivery latency | Eventual consistency |
| Realtime backlog/retry | Задержка UI |
| Timer due/overdue | Scheduler health |
| DB pool saturation | Capacity |
| WebSocket connections/drops | Realtime health |

Метрики, tracing и alert rules в текущем репозитории не реализованы.

### 26.3. Correlation

Целевой envelope должен переносить:

- command ID;
- correlation ID;
- causation ID;
- actor ID;
- Instance ID;
- Transition log ID;
- Outbox ID.

Текущая схема хранит часть идентификаторов, но единого end-to-end trace ID нет.

### 26.4. Readiness

Production readiness должна проверять:

- DB connectivity;
- Registry validation;
- required tables/procedures;
- registered Outbox handlers;
- Redis connectivity при выбранном Redis backend;
- миграционную версию;
- отсутствие критического stale backlog.

Текущий `/health` является liveness, а не полноценной readiness check.

## 27. Тестовая стратегия

### 27.1. Уровни

| Уровень | Назначение |
|---|---|
| Unit | Registry, resolver, Guard, Effect contracts |
| Contract | SQL Core result codes, API payload |
| Integration | MySQL, Redis, stored procedure |
| Concurrency | CAS, claim, append-only Trigger |
| Failure injection | Crash между claim/commit/send |
| Load | Throughput, pool, backlog |
| DR | Backup/restore/failover |
| Domain acceptance | Полные Taxi/Courier scenarios |

### 27.2. Текущий набор

Проходят:

- 16 быстрых тестов;
- 9 интеграционных тестов на MySQL 8 и Redis 7.

Проверяется:

- Runtime использует SQL Core v2;
- conflict является ошибкой;
- Trigger не может подменить FSM Action;
- post-transition Context;
- Outbox после commit;
- retry/stale recovery/idempotency;
- realtime fanout;
- authenticated Snapshot;
- role filtering;
- полный Worker -> ХП -> Outbox -> Realtime -> Snapshot;
- два конкурентных Transition;
- 100 параллельных команд: 50 success и 50 conflict;
- параллельный append Trigger;
- Redis fanout между двумя Hub.

### 27.3. Не покрыто

- длительный load/soak test;
- production Timer;
- DB failover;
- Redis failover;
- network partition;
- crash process в каждой точке pipeline;
- backup/restore;
- schema migration under traffic;
- полные Courier effects;
- performance SLA.

## 28. Реестр возможностей

### 28.1. Реализовано

- multi-domain Registry;
- ProcessDef и Action Resolver;
- table-driven scoped FSM;
- Guard/Effect Registry;
- Worker с отдельной транзакцией на Instance;
- `SKIP LOCKED`;
- stale Worker recovery;
- SQL Core CAS по `expected_state`;
- Action Log;
- append-only Trigger queue;
- Outbox at-least-once;
- HTTP Outbox Adapter;
- durable realtime journal;
- InMemory/Redis realtime;
- Snapshot/replay/WebSocket API;
- Principal и Entity access policy;
- read-only Snapshot Session;
- Taxi domain FSM;
- Courier structural migration;
- clean install и legacy migrations;
- startup validation;
- интеграционный Docker-стенд.

### 28.2. Частично

- declarative DSL;
- Courier domain;
- Core Adapter migration;
- command ingress;
- IAM;
- HA;
- DR;
- observability;
- error taxonomy;
- schema migration management;
- Context abstraction.

### 28.3. Экспериментально

- `fsm_timers`;
- `FsmTimerWorker`;
- Taxi pickup timeout scheduling;
- общая Timer-декларация в Transition.

### 28.4. Запланировано

- storage-neutral Context Provider;
- Provider capability validation;
- production Timer Service;
- multiple Effect model;
- Command HTTP API;
- command idempotency key;
- unified error envelope;
- metrics/tracing/readiness;
- automated schema migration;
- compensation/saga при подтверждённой потребности;
- решение о plugin discovery после третьего домена.

### 28.5. Не поддерживается текущим ядром

- hierarchy;
- parallel State;
- fork/join;
- history State;
- event-sourced rebuild;
- multi-region conflict resolution;
- exactly-once external HTTP без идемпотентного получателя.

## 29. Открытые вопросы и ограничения

1. Утвердить storage-neutral Context Provider API и план отвязки от Session.
2. Утвердить production Timer semantics, retry и stale recovery.
3. Утвердить внешний Command API и idempotency envelope.
4. Завершить перенос legacy Core calls на Outbox.
5. Утвердить авторитетный Courier graph и перенести Effects.
6. Определить численные RPO/RTO и production topology.
7. Выбрать migration tool и schema version table.
8. Определить retention для Instance, logs, Outbox и realtime.
9. Определить cleanup/archival jobs.
10. Добавить metrics, traces, readiness и alerting.
11. Определить handling terminal FAILED и ручной retry.
12. Определить versioning Trigger/Snapshot/API.
13. Решить, нужен ли plugin discovery после GreenMarket.
14. Решить, нужны ли hierarchy/parallel/saga по реальным доменам.

## 30. Критерии готовности Platform

### 30.1. Текущий вывод

Фундамент последовательной multi-domain FSM Platform сформирован и пригоден
для дальнейшей интеграции и тестовых окружений. Production readiness всей
универсальной платформы пока не достигнута из-за Timer, Context Provider,
Command API, observability и неподтверждённых RPO/RTO.

### 30.2. Обязательные критерии production

- все активные domain graphs утверждены;
- Registry startup validation проходит;
- legacy direct transition path отключён;
- внешние Effects используют Outbox;
- production Timer либо завершён, либо не требуется процессам;
- Command API авторизован и идемпотентен;
- DB/Redis topology утверждена;
- backup restore проверен;
- RPO/RTO измерены;
- readiness/metrics/alerts включены;
- concurrency/load/failure/DR tests проходят;
- runbook и ownership зафиксированы.

## 31. Трассировка требований ТЗ

| Требование | Раздел спецификации | Статус |
|---|---|---|
| Архитектура и компоненты | 3-4 | Закрыто |
| Runtime | 5 | Закрыто |
| Context | 14 | Закрыто |
| DSL | 7 | Закрыто с честной матрицей ограничений |
| Runtime API | 8 | Закрыто |
| Event Model | 9 | Закрыто |
| Action API | 10 | Закрыто |
| Guard API | 11 | Закрыто |
| Scheduler | 13 | Закрыто, реализация отмечена experimental |
| Context Provider | 15 | Закрыто как нормативный контракт и Gap |
| Plugin API | 16 | Закрыто |
| Adapter API | 17 | Закрыто |
| UI Integration | 18 | Закрыто |
| Persistence | 6 | Закрыто |
| Reliability & Recovery | 20 | Закрыто |
| Infrastructure profiles | 21 | Закрыто |
| Compatibility Matrix | 23 | Закрыто |
| Gap Analysis | 24 | Закрыто |
| Migration | 25 | Закрыто |
| Feature status | 28 | Закрыто |
| Open questions | 29 | Закрыто |
| Testing | 27 | Закрыто |
| Non-functional characteristics | 32 | Закрыто |

## 32. Нефункциональные характеристики

### 32.1. Потоко- и процессобезопасность

- SQLAlchemy Session не передаётся между потоками или Instance.
- Каждый Worker item получает отдельную Session и transaction.
- Межпроцессная конкурентность обеспечивается InnoDB row lock и CAS.
- Registry заполняется до startup validation и затем считается read-only.
- Dynamic registration/hot reload не являются thread-safe contract.
- InMemoryRealtimeHub работает в одном asyncio process; для кластера нужен Redis.

### 32.2. Кластерный режим

Поддерживаются несколько Fsm Worker, Outbox Worker, Realtime Publisher и Domain API.
Все узлы должны использовать общую DB. Domain API используют Redis transport
для cross-node realtime. Sticky sessions не требуются для Snapshot/replay; для WebSocket
их необходимость зависит от load balancer.

Leader election для claim-очередей не нужен: `SKIP LOCKED` распределяет работу.
DB/Redis failover обеспечивается инфраструктурой, а не Runtime.

### 32.3. Модель масштабирования

| Компонент | Способ масштабирования | Основное ограничение |
|---|---|---|
| Fsm Worker | Добавление Worker process | DB claim/locks, connection pool, hot Entity contention |
| Outbox | Добавление dispatcher | External API limits и DB backlog |
| Domain API | Добавление API nodes | DB read capacity и WebSocket connections |
| Realtime | Redis и Publisher replicas | Redis throughput и DB event journal |
| SQL Core | Vertical/HA DB, partitioning после измерений | Одна доменная DB и row contention |

Масштабирование Worker не ускоряет две конкурентные команды одной Entity: они
сериализуются через lock/CAS. Производительность растёт на независимых Entity.

### 32.4. Требования к Provider

Production Provider обязан поддерживать durable storage, atomic update,
compare-and-set/versioning, transaction и concurrent access. Полный capability contract
описан в разделе 15. Provider без этих capabilities может использоваться
только в development/demo после явного снижения гарантий.

### 32.5. Recovery characteristics

- Logical RPO Runtime: последний durable DB commit.
- Worker recovery delay: restart + `FSM_WORKER_LOCK_TIMEOUT_SECONDS` в худшем случае.
- Outbox recovery delay: restart + poll interval или processing lease timeout.
- Realtime recovery: reconnect + Snapshot/replay; push может быть потерян.
- DB/Redis/site RTO: не заявлен до выбора topology и failover test.
- Production Timer recovery: не подтверждён.

### 32.6. Производительность и capacity

Численные throughput/latency SLA не заявлены. Тест со 100 параллельными командами
подтверждает корректность CAS, но не capacity. До production нужны load/soak tests
на целевой DB topology с измерением:

- commands/second;
- p50/p95/p99 transition latency;
- DB lock wait и pool saturation;
- backlog drain rate;
- Outbox delivery latency;
- WebSocket connections и fanout latency.

### 32.7. Переносимость

Текущий persistence profile требует MySQL 8 capabilities: stored procedures,
JSON, InnoDB row locks и `SKIP LOCKED`. Python Runtime требует SQLAlchemy 2.x.
Перенос на PostgreSQL/Redis/other Provider не является заменой connection string:
потребуется Provider и новый atomic transition adapter.

### 32.8. Критерии приёмки NFR

- Concurrency tests на целевой DB проходят без double transition.
- Нагрузочные SLA измерены и зафиксированы.
- App nodes работают без shared in-process state.
- Redis loss не приводит к потере domain State.
- Backup restore и DB failover проверены.
- Численные RPO/RTO подтверждены тестом.
- Backlog, stale lease, conflict, retry и failure покрыты monitoring/alerts.

## Приложение A. Переменные окружения

| Переменная | Назначение | Default |
|---|---|---|
| `DB_DRIVER` | SQLAlchemy driver | `mysql+mysqlconnector` |
| `DB_HOST` | DB host | `localhost` |
| `DB_PORT` | DB port | `3307` |
| `DB_NAME` | DB name | `testdb` |
| `DB_USER` | DB user | `root` |
| `DB_PASSWORD` | DB password | `root` |
| `FSM_WORKER_ID` | Worker lease owner | hostname + pid |
| `FSM_WORKER_MAX_ATTEMPTS` | Instance attempts | `3` |
| `FSM_WORKER_LOCK_TIMEOUT_SECONDS` | Instance lease | `300` |
| `FSM_WORKER_BATCH_SIZE` | Batch size | `20` |
| `FSM_WORKER_POLL_SECONDS` | Poll interval | `1` |
| `FSM_REALTIME_ENABLED` | Запись realtime event | `1` |
| `FSM_REALTIME_BACKEND` | `memory` или `redis` | `memory` |
| `FSM_REDIS_URL` | Redis URL | `redis://localhost:6379/0` |
| `FSM_REALTIME_QUEUE_SIZE` | Subscriber queue | `100` |
| `FSM_REALTIME_BATCH_SIZE` | Publisher batch | `100` |
| `FSM_REALTIME_POLL_SECONDS` | Publisher poll | `0.5` |
| `FSM_API_KEYS_JSON` | MVP Bearer identities | Нет |
| `CORE_API_URL` | Core base URL | Обязательно для Outbox Worker |
| `CORE_API_TOKEN` | Core Bearer token | Нет |
| `CORE_API_TIMEOUT_SECONDS` | HTTP timeout | `10` |
| `OUTBOX_LOCK_TIMEOUT_SECONDS` | Outbox lease | `300` |
| `OUTBOX_BATCH_SIZE` | Outbox batch | `20` |
| `OUTBOX_POLL_SECONDS` | Outbox poll | `1` |

Default credentials допустимы только для development.

## Приложение B. Запуск

```bash
python -m pip install -r requirements.txt
python fsm_worker.py
CORE_API_URL=https://core.example.test python outbox_worker.py
uvicorn fsm_api:app --host 0.0.0.0 --port 8001
```

Multi-node realtime:

```bash
FSM_REALTIME_BACKEND=redis \
FSM_REDIS_URL=redis://redis:6379/0 \
uvicorn fsm_api:app --host 0.0.0.0 --port 8001
```

## Приложение C. Проверка

```bash
python -m unittest discover -s tests -v
./tests/run_platform_integration.sh
```

Интеграционный script поднимает MySQL 8 и Redis 7, применяет схему, выполняет
тесты и удаляет временную инфраструктуру.

## Приложение D. Решение о совместимости

Результат анализа должен формулироваться одним из вариантов:

| Решение | Условие |
|---|---|
| Compatible | Все обязательные capabilities имеют Full |
| Compatible with adapters | Нет архитектурных gaps, нужны Adapter |
| Compatible after platform extension | Нужны новые capabilities |
| Not compatible | Нарушается источник истины, atomicity или обязательный workflow |
| Undetermined | Недостаточно данных по процессу или reliability |
