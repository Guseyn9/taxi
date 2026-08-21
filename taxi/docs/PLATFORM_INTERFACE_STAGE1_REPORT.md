# Platform Interface Stage 1

**Статус:** реализован минимальный каркас  
**Дата:** 2026-08-08

## Объём

Stage 1 реализует минимальный Platform Interface, согласованный в
`PLATFORM_INTERFACE_REVIEW.md`:

- общий контракт `Surface`;
- типы `SurfaceId` и `SurfaceKind`;
- явный `SurfaceRegistry`;
- lifecycle `mount/unmount`;
- первую реализацию `MapSurface`;
- composition root Platform Interface;
- React-адаптер `useMapSurface`.

## Текущая цепочка

```text
Driver/Map.tsx
    -> useMapSurface
    -> MapSurface
    -> MapChannel
    -> Interaction Contract
    -> MapApplicationHandler
    -> Event
    -> MapSurface
    -> прежняя UI-реакция
```

`MapSurface` использует существующие `MapChannel`, `MapMapper`,
`MapApplicationHandler` и `AppInteractionContract`. Их публичные контракты и
формат Action/Event не изменены.

## Сохранённое поведение

- обычный тап по заказу открывает ту же карточку;
- в mock mode карточка не открывается;
- `driver.order.select` и `driver.order.selected` сохраняют прежние payload и
  `correlationId`;
- lifecycle безопасен для повторного mount/unmount в React StrictMode;
- прямые Redux/API-вызовы карты не мигрировались на этом этапе.

## Что не входит в Stage 1

- FSM и наполненный доменный Snapshot;
- Navigation Runtime;
- автоматическое обнаружение Surface;
- HUD/List/Simple/Chat Surface;
- миграция Passenger Channel;
- изменение Interaction Contract или Platform Core.

Базовый Runtime и граница FSM/Snapshot реализованы следующим этапом и описаны в
`PLATFORM_INTERFACE_RUNTIME.md`. Подключение конкретного серверного транспорта и
второй Surface остаются отдельными итерациями.
