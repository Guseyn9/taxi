# Frontend r14: закрытие замечаний CTO/QA

Дата: 7 ноября 2026. Ветка: `fix/frontend-20261107`. Предыдущий frontend: `e46648f` / r13. Отчёт CTO/QA относился к состоянию до этих исправлений. PHP, БД и общий сервер не менялись.

## Результат по замечаниям

| Пункт | Изменение frontend | Проверка |
|---|---|---|
| F01 / API-35, UI-37 | Отмена требует явного успешного API-конверта. `code:200/status:error`, неуспешный code и пустой ответ отвергаются. Thunk не выдаёт UPDATE_SUCCESS; перечитывает заказ и активный список. Форма/выбранный заказ сохраняются при ошибке. Тот же валидатор применён к мутациям машин. | `src/API/order.transport.test.js`, `src/components/modals/__tests__/cancel-business-errors.test.jsx`, `src/state/cars/lifecycle.test.js`; браузерный отказ и последующая успешная отмена на локальном fixture. |
| F02 / API-02, API-08 | Явно задано реальное покрытие bundled Agadir graph; чужие area ID отвергаются. Общий route consumer проверяет фактическое расстояние до узлов, максимум привязки 100 м, корректность пути и дистанции; короткие привязки включены в длину. Вне покрытия используется дорожный провайдер. | `src/API/way.coverage.test.js`, `src/tools/roadRoute.test.ts`, настоящий PackedWayGraph с inside/outside точками. |
| F03 / API-10, API-12 | У Passenger, Driver и прежнего tools/route теперь одна реализация OSRM с deadline 10 секунд, включая JSON body и fetch, игнорирующий abort. У пассажира есть ошибка с повтором; устаревший маршрут другого ключа не используется как результат нового расчёта. | Два timeout regression; provider tests; браузерный показ RouteFailure и действие «Повторить». |
| F04 / PRICE-33-03 | Резервный per-km тариф берётся из собственного default 2,5, независимо от call-out fee. Overrides тенанта сохраняются. | `src/siteConstants.pricing.test.ts`: отсутствующий ключ при call-out 40 и явный override 3,75. |
| F05 / UI-37-04 | Попутчик: take и Arrived должны успешно завершиться до запроса PIN. Локальная boarded-отметка появляется после успешного подтверждения PIN. Ошибки не подавляются; UI показывает ошибку и перечитывает состояние. Общая блокировка действий предотвращает пересечение с другой lifecycle-командой. | `src/tools/alongTheWayPickup.test.ts`: take failure, arrival failure, неверный PIN, успешный повтор без повторного take/arrive; существующие boarding projection/path suites. |
| F06 / API-09 | Числовые нулевые координаты допускаются. Null, NaN и координаты вне диапазона отвергаются. Исправлены также guards/маркеры Passenger Map. | Общий route regression и TypeScript. |
| F07 / UI | Убраны принудительный английский fallback Location и английский aria-label fullscreen. Учтены script-specific подписи. Debug/menu, exports и emulator panel скрыты в production; admin zones остаётся отдельным обычным пунктом администратора. | Locale/developmentTools tests; guest browser RU/Arabic desktop/mobile. Полный редакторский native review текстов всех девяти языков этим не заявляется; tenant business labels остаются данными сервера. |
| F08 / UI-37-05 | Сообщения об ошибках стоят в очереди. Каждый показ имеет ID; повторное закрытие старого диалога не пропускает следующую ошибку. При смене аккаунта очередь очищается; старый ID не повторяется. | `src/state/modals/messageQueue.test.ts`, session reset regression; браузерный последовательный показ двух ошибок. |

## Уточнение прежнего отчёта

В F02 первоначальный вывод о возможной привязке реального графа за сотни километров был слишком сильным. `WayGraph` и `PackedWayGraph` уже ограничивали поиск радиусом 1000 м. Мок с расстояниями 300–400 км нарушал этот контракт и не был воспроизведением production-поведения реального адаптера. Новые проверки используют настоящий packed graph и подтверждают отказ вне покрытия. Защита потребителя, явное географическое покрытие и учёт коротких привязок добавлены дополнительно. Это уточнение заменяет соответствующую трактовку старого CTO/QA PDF.

## Сборка и проверяемость

- Штатные Jest: 1199 tests, 219 suites; TypeScript, lint, canonical entrypoints и production gruzvill build.
- Новый fixture `src/qa/remediation-entry.tsx` собирается отдельно с CSP `connect-src 'none'`. Его ответы API заданы локально; он не входит в публичный release build и не создаёт заказов.
- `pre-build.js` больше не подменяет время каждым запуском. Дата меняется только при явно заданном `SOURCE_DATE_EPOCH`; повторная сборка одного исходника сохраняет JS-хэши.
- Точная проверка frontend boundary использует manifest с именованными исходниками, hash и regression evidence. Это локальный review разрешённых изменений, не доказательство серверной корректности.
- Сырые логи, screenshot evidence, точный commit и deployment digests сохраняются отдельно в пакете `frontend-completion-20261107`.

## Отдельная server/integration-приёмка

Это закрытие перечисленных frontend-дефектов и локальных regressions. Реальный сервис такси целиком ещё не принят. Нужны доступные тестовые Passenger/Driver аккаунты и backend evidence: неверный/чужой/replayed PIN, canonical Offer, авторизация заказов/чата/файлов, idempotency, GPS persistence/readback/expiry/dispatch, quote/settlement. Тенант gruzvill отдаёт GHS и Country_service=GHA / +233 при service_country=ma. Frontend не подменяет эти значения на MAD/+212 без согласования единиц и серверного контракта. Реальные iOS/Android, фоновые режимы GPS и парные поездки относятся к этой отдельной приёмке.
