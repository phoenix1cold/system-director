# SD Community Market — настройка реестра

Маркет внутри Foundry — это клиент. Каталог систем хранится в отдельном GitHub-репозитории (реестре) и раздаётся как статический `index.json`. Свой сервер не нужен.

## 1. Создайте репозиторий-реестр

Например `youruser/sd-market`. Включите GitHub Pages (Settings → Pages → deploy from branch `main`).

В корне — файл `index.json`:

```json
{
  "systems": [
    {
      "id": "dark-fantasy",
      "name": "Dark Fantasy",
      "author": "nickname",
      "version": "1.2.0",
      "description": "Мрачное фэнтези с санити-механикой.",
      "package": "https://github.com/nickname/df-system/releases/latest/download/dark-fantasy.sd-system.json",
      "rulebook": "https://github.com/nickname/df-system/releases/latest/download/rulebook.pdf",
      "repo": "https://github.com/nickname/df-system",
      "icon": "https://raw.githubusercontent.com/nickname/df-system/main/icon.png",
      "tags": ["fantasy", "horror"],
      "stars": 12,
      "downloads": 340
    }
  ]
}
```

Обязательные поля: `id`, `name`, `package`. Остальные опциональны.

## 2. Укажите адрес реестра в Foundry

Настройки системы SD → «Адрес реестра маркета»:

```
https://youruser.github.io/sd-market/index.json
```

(или `https://raw.githubusercontent.com/youruser/sd-market/main/index.json`)

## 3. Как авторы публикуют системы

1. В Foundry: Маркет → «Экспорт моей системы» → скачивается `*.sd-system.json` (атрибуты, ресурсы, листы, шаблоны узлов, библиотека функций и т.д.).
2. Автор кладёт пакет в свой репозиторий как GitHub Release (туда же — PDF рулбука, иконку).
3. Автор открывает Issue в репозитории-реестре по шаблону (Issue Form: название, описание, ссылки) — авторизация через GitHub из коробки.
4. GitHub Action валидирует ссылку на пакет и добавляет запись в `index.json` (автоматически или через PR-ревью — это и есть модерация).

## 4. Лайки и скачивания

- **Лайк = звезда** на репозитории системы (кнопка ⭐ на карточке в маркете ведёт на GitHub).
- Количество звёзд и скачиваний релизов собирает scheduled GitHub Action (раз в час/день) и записывает в `index.json` — клиенту не нужен GitHub API.

Пример шага Action для обновления счётчиков:

```yaml
# .github/workflows/refresh-stats.yml
name: Refresh stats
on:
  schedule: [{ cron: "0 * * * *" }]
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Update stars/downloads
        run: node scripts/refresh-stats.mjs   # обходит repo из index.json через GitHub API
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Commit
        run: |
          git config user.name sd-market-bot
          git config user.email bot@users.noreply.github.com
          git add index.json && git diff --cached --quiet || git commit -m "chore: refresh stats" && git push
```

## Формат пакета `*.sd-system.json`

```json
{
  "sdMarket": 1,
  "meta": { "name": "...", "author": "...", "version": "1.0.0", "description": "...", "sdVersion": "0.9.951" },
  "settings": {
    "systemSettings": {},
    "sheetTemplates": {},
    "customFields": {},
    "nodeTemplates": {},
    "functionLibrary": {},
    "initiativeFormula": "",
    "useEncumbrance": false
  },
  "content": {
    "npcs": [],
    "journals": [],
    "packs": [
      { "name": "my-items", "label": "My Items", "documentName": "Item", "documents": [] }
    ]
  }
}
```

Секция `content` опциональна и заполняется чекбоксами при экспорте (NPC, журналы, компендиумы мира). При установке всё это автоматически создаётся в мире; документы с уже существующими id пропускаются (повторная установка не создаёт дубликатов).

Для этого репозитория адрес реестра по умолчанию уже вшит в систему:
`https://raw.githubusercontent.com/phoenix1cold/sd-market/main/index.json`

При установке маркет перезаписывает эти world-настройки и перезагружает мир. Установка и просмотр каталога не требуют никакой регистрации; GitHub-аккаунт нужен только авторам (публикация) и для лайков (звёзды).
