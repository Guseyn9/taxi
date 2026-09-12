# TDM UI Coverage Matrix

Документ содержит фактический аудит UI-элементов приложения TDM (`Guseyn9/taxi`) и их сопоставление с текущим состоянием дизайн-системы Taxi DS (`stepanstepanec0-lang/taxi2332` ветка `main`).

---

## 1. Page-Level UI & Main Views

| TDM Element | TDM Path | Type | Usage | Taxi DS Element | Taxi Path | Status | Required Action | Rationale |
|---|---|---|---|---|---|---|---|---|
| `PassengerLiveOrder` | `src/components/PassengerLiveOrder`, `src/pages/Passenger` | page-level UI | Экран активного заказа пассажира с картой и статусами | — | — | `PARTIAL` | Декомпозировать страницу на паттерны DS (`Card`, `Button`, `Badge`) | Каркас использует смесь нативных элементов и локальных оберток. |
| `DriverDashboard / DriverMap` | `src/pages/Driver/Map.tsx`, `src/pages/Driver/index.tsx` | page-level UI | Главный рабочий экран водителя и HUD-интерфейс | — | — | `PARTIAL` | Перевести информационные блоки и статусы на DS `Card` и `Badge` | Экран содержит сырые теги и кастомные стилевые контейнеры. |
| `OrdersPage` | `src/pages/Driver/Orders.tsx` | page-level UI | Список доступных и активных заказов водителя | — | — | `PARTIAL` | Заменить локальные списки на DS `Card` и DS `Button` | Страница содержит смешанные элементы управления. |
| `OrderDetailsPage` | `src/pages/Order/index.tsx` | page-level UI | Экран детальной информации о конкретном заказе | — | — | `PARTIAL` | Унифицировать карточки параметров через DS `Card` и DS `Button` | Использованы кастомные блоки с прямыми вызовами API/шлюзов. |
| `PassengerVoting` | `src/pages/Passenger/VotingForm.tsx` | page-level UI | Форма голосования и выбора условий пассажиром | — | — | `PARTIAL` | Перевести элементы формы на DS `Button` и DS `Input` | Содержит нативные кнопки и локальные SCSS-отступы. |

---

## 2. Composite Components & Feature Modules

| TDM Element | TDM Path | Type | Usage | Taxi DS Element | Taxi Path | Status | Required Action | Rationale |
|---|---|---|---|---|---|---|---|---|
| `Chat` | `src/components/Chat` | composite component | Модуль переписки между водителем и пассажиром | — | — | `MISSING` | Сформировать паттерн Chat/MessageList в DS или токенизировать текущий | В ветке `main` Taxi DS отсутствуют компоненты сообщений и чата. |
| `ConstructorTab` | `src/components/ConstructorTab` | composite component | Вкладки конструктора параметров заказа | `Tabs` | `src/components/Tabs` | `PARTIAL` | Перевести внутренние кнопки и контейнеры конструктора на DS | Использует концепцию вкладок DS, но дочерние элементы содержат нативную верстку. |
| `CompareVariants` | `src/components/CompareVariants` | composite component | Таблица сравнения вариантов тарифов и условий | — | — | `MISSING` | Разработать карточный паттерн сравнения на базе DS `Card` | В Taxi DS отсутствует готовый паттерн сравнения тарифов. |
| `DriverEmulatorPanel` | `src/components/DriverEmulatorPanel` | composite component | Панель эмулятора действий водителя для отладки | — | — | `SPECIALIZED` | Токенизировать цвета и фоны; применить DS `Button` для органов управления | Служебный инженерный инструмент. Композиция уникальна, но визуальные примитивы требуют DS. |
| `furniture` | `src/components/furniture` | composite component | Выбор опций перевозки мебели и крупногабарита | — | — | `SPECIALIZED` | Перевести внутренние кнопки на DS `Button` и применить токены сетки | Доменная структура сохраняется, но внутренние контролы требуют токенизации. |
| `BigTruckServices` | `src/components/BigTruckServices` | composite component | Выбор специализированных услуг для грузового такси | — | — | `SPECIALIZED` | Заменить внутренние нативные кнопки на DS `Button`, использовать DS `Card` | Компонент специализирован по структуре, но примитивы должны использовать DS. |
| `GrouppedInputs` | `src/components/GrouppedInputs` | composite component | Группы полей ввода в формах заказа | `Input` | `src/components/Input` | `PARTIAL` | Обернуть группу в системный контейнер DS с токенами `gap` | Поля используют DS `Input`, но обертка группы содержит локальные SCSS-отступы. |
| `rooms` | `src/components/rooms` | composite component | Селектор комнат и адресов назначения | — | — | `SPECIALIZED` | Токенизировать внутреннюю сетку и перевести кнопки на DS `Button` | Уникальный интерфейс выбора. Требует приведения внутренних примитивов к DS. |
| `LocationInput` | `src/components/LocationInput` | composite component | Поле ввода адреса с кнопками геопозиции и очистки | `Input` | `src/components/Input` | `PARTIAL` | Заменить кастомные иконки-кнопки на DS `Button` / `IconButton` | Поле ввода базовое, но вспомогательные кнопки выполнены сырыми тегами. |
| `Header` | `src/components/Header` | composite component | Шапка приложения с навигацией и профилем | `Container` | `src/components/Container` | `PARTIAL` | Перевести элементы навигации на DS `Button` | Контейнер использует DS, но внутренние переключатели не токенизированы. |
| `MiniOrders` / `MiniOrder` | `src/components/MiniOrders`, `src/components/MiniOrder` | composite component | Компактные карточки заказов в списках | `Card` | `src/components/Card` | `PARTIAL` | Отрефакторить кнопки действий и плашки статусов внутри карточек | Каркас карточки соответствует DS `Card`, но внутренние кнопки выполнены в legacy-стиле. |

---

## 3. Modals System (Decomposed)

| TDM Element | TDM Path | Type | Usage | Taxi DS Element | Taxi Path | Status | Required Action | Rationale |
|---|---|---|---|---|---|---|---|---|
| `LoginModal` | `src/components/modals/LoginModal` | modal | Модальное окно авторизации и ввода рефкода | `Modal` | `src/components/Modal` | `PARTIAL` | Обернуть в DS `Modal`, запустить DS `Input` и DS `Button` | Использует кастомные обертки и сырые элементы ввода. |
| `CardModal` | `src/components/modals/CardModal.tsx` | modal | Карточка деталей заказа во время поездки | `Modal` | `src/components/Modal` | `PARTIAL` | Заменить внутренние действия на DS `Button`, очистить SCSS | Обертка соответствует модалке, но контент содержит кастомные кнопки. |
| `ProfileModal` | `src/components/modals/ProfileModal.tsx` | modal | Модальное окно профиля пользователя/водителя | `Modal` | `src/components/Modal` | `PARTIAL` | Применить DS `Modal` и токенизировать поля формы | Внутренние списки и кнопки требуют перевода на примитивы DS. |
| `CandidatesModal` | `src/components/modals/CandidatesModal.tsx` | modal | Список кандидатов-водителей на заказ | `Modal` | `src/components/Modal` | `PARTIAL` | Перевести карточки кандидатов на DS `Card` и DS `Button` | Содержит нативные кнопки выбора и кастомную верстку. |
| `VoteModal` | `src/components/modals/VoteModal.tsx` | modal | Модальное окно голосования за условия поездки | `Modal` | `src/components/Modal` | `PARTIAL` | Заменить элементы выбора и подтверждения на DS `Button` | Нарушает гайдлайны кнопок DS внутри модального окна. |
| `DriverCancelModal` | `src/components/modals/DriverCancelModal.tsx` | modal | Подтверждение отмены заказа водителем | `Modal` | `src/components/Modal` | `PARTIAL` | Применить DS `Modal`, перевести кнопки отмены на DS `Button` | Использует нативные теги `<button>` для действий отмены. |
| `DriverModal` | `src/components/modals/DriverModal.tsx` | modal | Карточка информации о назначенной машине и водителе | `Modal` | `src/components/Modal` | `PARTIAL` | Обернуть в DS `Modal`, запустить DS `Badge` для статусов | Содержит нетокенизированные плашки статусов. |
| `OnTheWayModal` | `src/components/modals/OnTheWayModal.tsx` | modal | Окно состояния «Водитель в пути» | `Modal` | `src/components/Modal` | `PARTIAL` | Перевести элементы управления и таймеры на примитивы DS | Контент окна содержит локальную верстку и сырые кнопки. |
| `RatingModal` | `src/components/modals/RatingModal.tsx` | modal | Окно оценки поездки и отзыва | `Modal` | `src/components/Modal` | `PARTIAL` | Заменить контролы оценки и кнопку отправки на DS `Button` | Форма оценки не интегрирована с компонентами DS. |
| `TakePassengerModal` | `src/components/modals/TakePassengerModal.tsx` | modal | Окно предложения взятия попутного пассажира | `Modal` | `src/components/Modal` | `PARTIAL` | Применить DS `Modal`, перевести кнопки согласия/отказа на DS | Используются нативные кнопки с локальными стилями. |
| `OrderModeDecisionModal` | `src/components/OrderModeDecisionModal` | modal | Подтверждение выбора режима заказа | `Modal` | `src/components/Modal` | `PARTIAL` | Заменить кастомные кнопки на DS `Button`, обернуть в DS `Modal` | Контейнер не токенизирован, действия выполнены сырыми тегами. |
| `OrderModeSubModeModal` | `src/components/OrderModeSubModeModal` | modal | Выбор подрежима заказа | `Modal` | `src/components/Modal` | `PARTIAL` | Перевести списки вариантов и закрытие на DS `Button` | Долг по токенизации содержимого модального окна. |

---

## 4. Standalone Components & UI Feedback

| TDM Element | TDM Path | Type | Usage | Taxi DS Element | Taxi Path | Status | Required Action | Rationale |
|---|---|---|---|---|---|---|---|---|
| `CarClassBadge` | `src/components/CarClassBadge` | component | Плашка с классом автомобиля (Эконом, Комфорт) | `Badge` | `src/components/Badge` | `PARTIAL` | Перевести цветовые схемы классов на семантические токены DS | Использован DS `Badge`, но палитра классов захардкожена в SCSS. |
| `CarClassSlider` | `src/components/CarClassSlider` | component | Слайдер выбора класса автомобиля | `Slider` | `src/components/Slider` | `PARTIAL` | Перевести карточки вариантов на DS `Card` и DS `Slider` | Кастомная обертка над слайдером, требующая токенизации. |
| `DateTimeIntervalInput` | `src/components/DateTimeIntervalInput` | component | Выбор даты, времени и интервала заказа | — | — | `MISSING` | Создать DS-компонент `DateTimePicker` в рамках следующих ТЗ | В ветке `main` Taxi DS полностью отсутствует компонент работы с датой/временем. |
| `OrderModeToast` | `src/components/OrderModeToast` | component | Всплывающее уведомление о смене режима | — | — | `MISSING` | Разработать системный DS-компонент `Toast` / `Snackbar` | В текущем Taxi DS отсутствует компонент тостов/уведомлений. |
| `ErrorFrame` | `src/components/ErrorFrame` | component | Экран/плашка отображения ошибок | — | — | `MISSING` | Разработать DS-компонент `Alert` с поддержкой токенов ошибок | В текущем DS нет системы плашек ошибок. |
| `DriverStatusAvatar` | `src/components/DriverStatusAvatar` | component | Аватар водителя с индикатором статуса | — | — | `MISSING` | Создать DS-компонент `Avatar` с поддержкой статусов | В ветке `main` Taxi DS отсутствует компонент `Avatar`. |
| `DriverStatusIcon` | `src/components/DriverStatusIcon` | component | Иконка текущего состояния водителя | `Badge` | `src/components/Badge` | `COVERED` | None | Напрямую сопоставляется с имеющимся в DS компонентом `Badge`. |
| `ShortInfo` | `src/components/ShortInfo` | component | Плашка краткой информации о заказе | `Card` | `src/components/Card` | `COVERED` | None | Корректно отображается через существующий DS `Card`. |

---

## 5. Contextual Breakdown of Raw UI Elements

| Context / Location | TDM Path | Type | Usage | Taxi DS Element | Taxi Path | Status | Required Action | Rationale |
|---|---|---|---|---|---|---|---|---|
| `Raw <button> (Map Controls)` | `src/components/BoundaryButtons`, `src/components/Map` | control | Кнопки масштабирования, границ и слоев карты | `Button` | `src/components/Button` | `PARTIAL` | Заменить сырые кнопки управления картой на DS `Button` / `IconButton`, сохранив positioning Leaflet | Использование нативных кнопок вместо DS `Button`. Контекст карты не освобождает кнопки от DS. |
| `Raw <button> (Modal Actions)` | `src/components/modals/*` | control | Кнопки закрытия, отмены и действия в модалках | `Button` | `src/components/Button` | `PARTIAL` | Заменить все сырые теги `<button>` на DS `Button` | Нативные теги вместо DS `Button` внутри модальных окон. |
| `Raw <button> (Forms & Page Controls)` | `src/components/GrouppedInputs`, `src/pages/*` | control | Кнопки отправки форм, переключатели в полях | `Button` | `src/components/Button` | `PARTIAL` | Заменить сырые теги `<button>` на DS `Button` | Использование нативных тегов вместо DS `Button` в формах и на страницах. |

---

## 6. Primitives & Base Controls

| TDM Element | TDM Path | Type | Usage | Taxi DS Element | Taxi Path | Status | Required Action | Rationale |
|---|---|---|---|---|---|---|---|---|
| `Button` | `src/components/Button` | primitive | Базовая кнопка TDM | `Button` | `src/components/Button` | `PARTIAL` | Унифицировать API пропсов и перевести SCSS-стили на токены | Компонент есть в обоих репозиториях, но TDM-версия использует кастомный SCSS. |
| `Card` | `src/components/Card` | primitive | Базовый контейнер-карточка | `Card` | `src/components/Card` | `PARTIAL` | Заменить кастомные отступы и тени на семантические токены DS | Компонент есть в DS, но TDM-версия содержит локальный SCSS. |
| `Checkbox` | `src/components/Checkbox` | primitive | Чекбокс | `Checkbox` | `src/components/Checkbox` | `COVERED` | None | Полностью соответствует реализации в DS. |
| `Block` | `src/components/Block` | primitive | Структурный контейнер | `Container` | `src/components/Container` | `COVERED` | None | Соответствует примитиву DS `Container`. |
| `Burger` | `src/components/Burger` | control | Кнопка гамбургер-меню | — | — | `MISSING` | Заменить `react-hamburger-button` на DS `Button` с иконкой | В DS нет отдельного гамбургера; требуется замена внешней библиотеки. |
| `LoadFrame` | `src/components/LoadFrame` | component | Индикатор загрузки | `Spinner` | `src/components/Spinner` | `COVERED` | None | Использует существующий DS `Spinner`. |
| `OpacityLayer` | `src/components/OpacityLayer` | utility UI | Оверлей затемнения | `Backdrop` | `src/components/Backdrop` | `DUPLICATE` | Удалить `OpacityLayer`, перевести вызовы на DS `Backdrop` | Самостоятельный компонент TDM, дублирующий имеющийся DS `Backdrop`. |
| `OrderModeButton` | `src/components/OrderModeButton` | control | Переключатель режимов заказа | `Button` | `src/components/Button` | `PARTIAL` | Перевести на DS `Button` с вариацией активного состояния | Кастомная обертка поверх кнопок. |
| `loader` | `src/components/loader` | primitive | Локальный строчный спиннер | `Spinner` | `src/components/Spinner` | `DUPLICATE` | Удалить локальный `loader`, перевести на DS `Spinner` | Локальный компонент, дублирующий имеющийся в DS `Spinner`. |
| `separator` | `src/components/separator` | primitive | Разделитель | `Divider` | `src/components/Divider` | `COVERED` | None | Полностью соответствует DS `Divider`. |
| `slider` | `src/components/slider` | control | Ползунок | `Slider` | `src/components/Slider` | `COVERED` | None | Полностью соответствует DS `Slider`. |
| `switch-slider` | `src/components/switch-slider` | control | Переключатель (свитч) | `Switch` | `src/components/Switch` | `COVERED` | None | Полностью соответствует DS `Switch`. |
| `tabs` | `src/components/tabs` | composite component | Панель вкладок | `Tabs` | `src/components/Tabs` | `PARTIAL` | Перевести кастомные границы и ховеры на токены DS | Использует DS `Tabs`, но содержит кастомный SCSS. |
| `version-info` | `src/components/version-info` | utility UI | Футер с версией сборки | — | — | `LEGACY-UI` | Оставить как отладочный служебный элемент | Не относится к продуктовой дизайн-системе. |

---

## 7. Map UI & Overlays

| TDM Element | TDM Path | Type | Usage | Taxi DS Element | Taxi Path | Status | Required Action | Rationale |
|---|---|---|---|---|---|---|---|---|
| `Map Routes & Markers` | `src/components/Map` | map UI | Линии маршрутов и маркеры подачи/высадки | — | — | `SPECIALIZED` | Сохранить разделение палитр `driverRoute`/`mapRoute`, токенизировать оверлеи | Специализированный UI карты. Внутренние оверлеи подлежат токенизации. |
| `objectHints` | `src/components/objectHints` | map UI | Подсказки объектов карты Leaflet | — | — | `SPECIALIZED` | Применить токены типографики к обертке Leaflet | Специфично для API карт Leaflet. |

---

## Summary Statistics

* **Total Evaluated UI Units:** 55
* **COVERED:** 8
* **PARTIAL:** 31
* **DUPLICATE:** 2
* **MISSING:** 7
* **SPECIALIZED:** 6
* **LEGACY-UI:** 1

---

## Key Architecture Guidelines

1. **Разделение понятий SPECIALIZED и Primitives:** Статус `SPECIALIZED` означает, что уникальная доменная или техническая структура/композиция компонента оправдана (например, для `furniture`, `BigTruckServices`, `rooms`, `DriverEmulatorPanel`, элементов карты). Это **НЕ освобождает** внутренние примитивы компонента (кнопки, карточки, отступы, цвета, типографику) от перевода на Taxi DS там, где соответствующие примитивы существуют.
2. **Фактическое состояние Taxi DS (`main`):** Компоненты, отсутствующие в ветке `main` Taxi DS (`Chat`, `CompareVariants`, `DateTimePicker`, `OrderModeToast`, `ErrorFrame`, `DriverStatusAvatar`, `Burger`), отмечены как `Taxi DS Element = —`, `Taxi Path = —` со статусом `MISSING`.
3. **Классификация Raw `<button>`:** Сырые теги `<button>` классифицированы по контекстам использования как `PARTIAL` (частичное применение паттерна `Button` через нативные теги) и подлежат замене на DS `Button` / `IconButton` в рамках ТЗ №2.
4. **Область применения PR:** В рамках данного PR изменения кода TDM не производятся. Документ фиксирует текущее состояние интерфейса и формирует точный перечень задач для ТЗ №2 — Component Unification.
