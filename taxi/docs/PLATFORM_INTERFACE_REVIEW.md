# Ревью Platform-слоя перед Stage 2

**Статус:** завершено  
**Область:** `src/platform/`, `src/pages/Driver/Map.tsx`,
`src/pages/Driver/index.tsx`, `src/Routes.tsx`, `src/App.tsx`  
**Основание:** состояние ветки `main` на коммите `c0c8810`

**Статус реализации:** минимальный каркас из этого ревью реализован 2026-08-08.
Фактический состав и границы результата зафиксированы в
`PLATFORM_INTERFACE_STAGE1_REPORT.md`.

## Цель

Перед созданием `platform-interface` проверить существующий код и ответить на
четыре вопроса:

1. Что уже можно считать частью будущего Platform Interface?
2. Что уже похоже на Surface?
3. Что придётся вынести из Map Channel?
4. Что не нужно менять?

Ревью не меняет поведение Stage 1 и не предлагает строить вторую архитектуру
рядом с существующей.

## Текущая цепочка

```text
Driver/Map.tsx
    │ user intent
    ▼
useMapChannel
    │
    ▼
MapChannel -> MapMapper -> Interaction Contract
                              │
                              ▼
                    MapApplicationHandler
                              │ Event
                              ▼
                       useMapChannel
                              │ UI reaction
                              ▼
                       Driver/Map.tsx
```

Stage 1 уже отделяет семантическое действие от React-компонента, но слой
представления пока не назван и частично смешан с React-адаптером канала.

## 1. Что уже можно считать основой Platform Interface

### Готовые основания

- `interaction-contract/` задаёт универсальную границу Action, Event и Snapshot.
  Это зависимость PI, но не сам PI.
- `AppInteractionContract` реализует двустороннюю in-memory шину. Класс почти не
  зависит от карты и уже пригоден для нескольких способов представления.
- `useMapChannel` связывает Event контракта с UI-реакцией. Именно эта часть ближе
  всего к будущей границе PI: она преобразует событие приложения в действие
  пользовательского представления.
- `MapApplicationHandler` показывает правильную обратную связь
  `Action -> Event`, не импортируя React, Redux или модалки.

### Чего пока нет

- общей модели Surface;
- Registry для доступных Surface;
- описания Presentation и Content;
- единой навигации между Surface;
- Surface-level API доступных пользовательских действий;
- точки сборки PI над несколькими каналами.

На момент ревью Platform Interface ещё не был реализован, но для него уже
существовала рабочая контрактная граница. Минимальная реализация появилась после
ревью и описана в `PLATFORM_INTERFACE_STAGE1_REPORT.md`.

## 2. Что уже похоже на Surface

### Map Surface

Фактический кандидат на Map Surface — не класс `MapChannel`, а связка:

```text
pages/Driver/index.tsx
    -> выбирает вкладку Map и управляет её жизненным циклом
pages/Driver/Map.tsx
    -> формирует пользовательское представление карты
useMapChannel.ts
    -> связывает представление с Interaction Contract
```

`MapChannel` является транспортом намерений и событий. Surface находится выше:
он включает отображение, локальное состояние представления и привязку канала.

### Кандидаты на следующие Surface

- вкладки Lite/Detailed в `pages/Driver/index.tsx` похожи на будущий List Surface;
- карточки и подсказки поверх карты являются кандидатами на HUD, но пока не имеют
  отдельного жизненного цикла;
- `Routes.tsx` создаёт экраны приложения, но ещё не является Surface Registry;
- `App.tsx` остаётся composition root React-приложения и пока не собирает PI.

Эти элементы нельзя объявлять готовыми Surface до появления общего контракта и
регистрации.

## 3. Что придётся вынести или разделить

### Из `map-channel/`

1. `AppInteractionContract` и типы `IApplicationContract`/`TActionHandler` не
   являются специфичными для карты. После появления второго Surface их следует
   перенести в общий application/runtime слой Platform, сохранив API и поведение.
2. `useMapChannel` сейчас одновременно:
   - создаёт и регистрирует Channel/Application Handler;
   - преобразует Event в UI-реакцию `setOrderCardModal`.

   На Stage 2 эти ответственности следует разделить: lifecycle канала оставить
   адаптеру Map Channel, а UI-реакцию разместить в адаптере Surface Map.
3. Модульные singleton `contract` и `channel` должны создаваться composition root
   PI, когда появится больше одного Surface. До этого перенос не нужен.

### Из `Driver/Map.tsx`

В Surface Map следует вынести только границу представления:

- подключение Map Channel;
- преобразование PI Event в локальную UI-реакцию;
- декларацию идентификатора и возможностей Surface Map.

Leaflet rendering, маршруты, маркеры, мок-режим и локальная визуальная логика
остаются в существующем компоненте. Их перенос не нужен для доказательства модели
Surface.

## 4. Что не нужно менять

- `src/platform/interaction-contract/`: это внешняя побайтовая копия контракта.
- `MapMapper`: чистое преобразование остаётся на месте.
- `MapChannel`: транспортная семантика и публичный метод `selectOrder` сохраняются.
- `MapApplicationHandler`: поведение `driver.order.select ->
  driver.order.selected` сохраняется.
- Формат логов `[InteractionContract]` и `correlationId`.
- Наблюдаемое поведение `Driver/Map.tsx` и обработка mock mode.
- Прямые Redux/API-связи, перечисленные в `STATE_AND_API.md`: они мигрируют на
  Stage 3, а не одновременно с каркасом PI.
- `Routes.tsx` и `App.tsx` на первом шаге: интеграция Surface Registry в routing
  выполняется только после проверки Map Surface.

## Минимальный каркас Stage 2

Ревью показывает, что для первого доказательства достаточно:

```text
src/platform/platform-interface/
    index.ts
    types.ts
    Surface.ts
    SurfaceRegistry.ts
    surfaces/
        map/
            MapSurface.ts
```

Минимальные ответственности:

- `Surface` — идентификатор, вид Surface и lifecycle подключения;
- `SurfaceRegistry` — явная регистрация и получение Surface;
- `MapSurface` — адаптер существующего Map Channel без новой бизнес-логики;
- `types.ts` — `SurfaceId`, `SurfaceKind` и общий lifecycle contract.

`Presentation.ts` и `Content.ts` не следует вводить пустыми только ради полной
схемы. Их стоит добавить после Map Surface или Simple Surface, когда появится
вторая реальная реализация и станет понятна общая семантика.

## Критерий первой реализации

Stage 2 начинается с Map Surface и считается доказанным, если:

1. Map Surface зарегистрирован через Surface Registry.
2. Он использует существующий Map Channel и Interaction Contract.
3. Тап по заказу по-прежнему создаёт ту же пару Action/Event.
4. Карточка в обычном режиме открывается как раньше, а в mock mode не открывается.
5. Тесты Stage 1 проходят без изменения ожидаемого поведения.
6. Platform Core, Mapper, Handler и внешний Interaction Contract не получают
   зависимостей от React Surface.

После этого можно добавлять Simple как вторую реализацию, а затем HUD, List и
Chat. Voice подключается как модальность поверх Surface, а не как отдельный
Surface.

## Решение

Новая архитектура рядом с существующей не нужна. Stage 2 должен обернуть
работающую связку Map Channel минимальной моделью Surface, затем подтвердить её
второй реализацией. Большая часть Stage 1 сохраняется без изменений.
