# Ключи интерфейса для конфигурации БД

Серверные переводы имеют приоритет. Рабочая БД не менялась. Отсутствующие переводы используют локальный fallback. Сохранены исходные ключи `to_order`, `vote`, `client_offer_short_button`, `client_offer_order_button`, `client_offer_hint`.

Полный список EN/RU/FR/AR: [localization-keys.json](./localization-keys.json). Для остальных языков сервиса нужны переводы БД; полного покрытия ZGH локальный английский fallback не доказывает.

Новые группы: `auth_ui_*`, `booking_readiness_*`, `booking_supply_*`, `dialog_ui_*`, `zone_check_*`, `location_action`. Готовность: подмена значений БД для Location, Vote, страны телефона и ошибок проверена тестом без пересборки. RTL раскладку по-прежнему задаёт выбранный язык.
