# ID расширения и перенос данных

## Почему ID меняется

У распакованного расширения без поля `key` в манифесте ID вычисляется из абсолютного
пути к папке. Подобрать `key` под уже существующий «путевой» ID нельзя. Поэтому при
переходе на сборку WXT (другая папка — `.output/chrome-mv3`) ID сменится, а
`chrome.storage.local` старой установки станет недоступен.

## Что делаем

1. **Новое расширение получает фиксированный `key`** (см. ниже). Его ID больше не зависит
   от папки: dev-сборка, прод-сборка и zip — всегда один и тот же ID.
2. **Данные переносим через экспорт/импорт** (кнопки в тулбаре конструктора, рядом с
   шаблонами): старое расширение → «Экспорт данных» → JSON; новое → «Импорт данных».
   Формат файла — `app/lib/backup.ts` (`format: "ph-creator-task-backup"`).

## Ключ для манифеста

Публичная часть — в `manifest.key`. Приватный ключ `extension-key.pem` лежит в корне репозитория,
в git не попадает (`.gitignore`); он нужен только для подписи `.crx`, для распакованной
установки и zip не требуется.

```
ID: ebpabdcmngdgiallonghpgddgcedebka
```

```
"key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAgx3p8N1B4cgw/kmZfH+PdmY6IWNMUygE3ZsJmO58W1fUbSiYspjaOB9/bH4Js6QL95REKX1POlU14It4H067Nh3vZJub4MMjj/CEvBZrOnms/gEnWiiJNbMryHgXYsLUsdQKeZ7N8gw/fPY3+AFGDgg4XWAJEfqPalMhf3z7iEE6eOkiKOro4ylqTSzoKdXKdrfZ619LbVbnYAKbnhpElnoS+5sYKDBfautJZTn1n0L1RKf7NeaYmHn/G92GWOMQb9uPV0cqscVHpvpvTa12E05NS5t1Zm1gSleKagsbe1Y4kM7FlhkbKLjEMWPe5tzbRzk8gJrFL6yLYDrTx6+A+wIDAQAB"
```

## Что лежит в storage (переносится целиком)

| Ключ                                                            | Содержимое                    |
| --------------------------------------------------------------- | ----------------------------- |
| `ph_admin_domains`                                              | список доменов админок        |
| `ph_auth_sessions`                                              | сессии авторизации по доменам |
| `ph_canvas_templates`                                           | шаблоны канвы по доменам      |
| `ph_chains_layout_<domain>`                                     | позиции карточек на канве     |
| `ph_captured_requests`, `ph_capture_enabled`, `ph_max_requests` | перехват запросов             |
| `ph_graphic_auth`, `ph_graphic_base_url`                        | авторизация Graphic API       |
| `ph_graphic_project_by_domain`                                  | проект Graphic для домена     |
