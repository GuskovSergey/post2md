# post2md

CLI-утилита на Node.js и TypeScript для загрузки веб-статей по URL и преобразования их в чистый GitHub Flavored Markdown (GFM) с YAML frontmatter, локальным сохранением изображений и интерактивным TUI-интерфейсом.

## Возможности

- **Умное извлечение контента**: автоматическое выделение основного текста статьи через `@mozilla/readability` или точный выбор элементов по CSS-селектору (`-s, --selector`).
- **Конвертация в GFM Markdown**: таблицы, зачеркнутый текст, списки задач, блоки кода с автоопределением языка (`language-*`, `lang-*`, `highlight-source-*`, `brush:*`, `data-language`, `data-lang`).
- **YAML frontmatter**: автоматическая запись метаданных (`title`, `source_url`, `author`, `published_at`, `fetched_at`), отключаемая флагом `--no-frontmatter`.
- **Локальное скачивание изображений** (`--download-images`): загрузка картинок в `assets/<slug>/` рядом с итоговым `.md`-файлом, нормализация `srcset` и lazy-load атрибутов (`data-src`, `data-lazy-src`, `data-original`, `data-url`), замена ссылок на относительные пути.
- **Гибкое именование файлов**: транслитерация кириллицы (русский и украинский алфавиты) в ASCII slug, шаблоны `--filename-template` (`{slug}`, `{date}`, `{domain}`, `{author}`), группировка по доменам (`--group-by-domain`) и защита от коллизий имён в пакетном режиме.
- **Несколько источников URL**: аргументы командной строки, текстовый файл (`-i, --input`), системный буфер обмена (`--from-clipboard`) или поток `stdin`.
- **Интерактивный TUI-режим** (`@clack/prompts`): пошаговый мастер настройки при запуске без аргументов в TTY (или с флагом `-I, --interactive`), прогресс-бар в пакетном режиме и интерактивное разрешение конфликтов при совпадении имён файлов.
- **Надёжный HTTP-клиент**: следование редиректам, таймауты, настраиваемые заголовки и `User-Agent`, до 2 автоматических повторов (с экспоненциальной задержкой) при сетевых сбоях и статусах `408`, `429`, `500`, `502`, `503`, `504`.
- **Структурированное логирование**: логи Pino в формате JSON выводятся в `stderr` (`--json`, `-v`, `-q`), оставляя `stdout` чистым для `--stdout`.

## Требования

- **Node.js** `>= 20.0.0`
- Для опций `--from-clipboard` и `--copy`:
  - **macOS**: встроенные `pbpaste` / `pbcopy`
  - **Windows**: `powershell` (`Get-Clipboard`) / `clip`
  - **Linux**: одна из утилит `wl-clipboard` (`wl-paste`/`wl-copy`), `xclip` или `xsel`

## Установка и сборка

```bash
npm install
npm run build
```

Для глобального вызова команды `post2md` из любой директории:

```bash
npm link
```

Для запуска без предварительной сборки в режиме разработки:

```bash
npm run dev -- https://example.com/blog/my-post
```

## Использование

```bash
post2md [options] [urls...]
```

### Примеры

```bash
# Запустить интерактивный мастер настройки (в TTY без аргументов или с -I / --interactive)
post2md

# Сохранить пост в <slug>.md в текущей директории
post2md https://example.com/blog/my-post

# Указать выходной файл и скачать изображения локально в assets/<slug>/
post2md https://example.com/blog/my-post -o ./saved/post.md --download-images

# Задать шаблон имени файла и разложить статьи по подпапкам доменов
post2md https://example.com/blog/my-post -o ./articles --filename-template "{date}-{slug}" --group-by-domain

# Взять URL из буфера обмена и скопировать готовый Markdown обратно в буфер
post2md --from-clipboard --copy

# Пакетная загрузка из файла (поддерживаются комментарии # и несколько URL в строке)
post2md -i urls.txt -o ./output --concurrency 5

# Передать список URL через stdin
cat urls.txt | post2md -o ./output --concurrency 4

# Вывести чистый Markdown в stdout без YAML frontmatter
post2md https://example.com/blog/my-post --stdout --no-frontmatter

# Извлечь контент по CSS-селектору и передать кастомный заголовок
post2md https://example.com/blog/my-post -s "article.post-content" -H "Authorization: Bearer <token>"

# Выводить структурированные JSON-логи Pino в stderr даже в интерактивном терминале
post2md https://example.com/blog/my-post --json
```

### Опции командной строки

| Опция | Описание | По умолчанию |
| --- | --- | --- |
| `[urls...]` | Один или несколько HTTP/HTTPS URL для загрузки | `[]` |
| `-I, --interactive` | Запустить интерактивный мастер настройки | `false` |
| `-i, --input <file>` | Файл со списком URL (поддерживаются переносы строк, пробелы, запятые и комментарии `#`) | — |
| `--from-clipboard` | Прочитать URL из системного буфера обмена | `false` |
| `-o, --output <path>` | Путь к выходному файлу (для одного URL) или к директории | текущая папка |
| `--filename-template <pattern>` | Шаблон имени файла без `.md`: `{slug}`, `{date}`, `{domain}`, `{author}` | `{slug}` |
| `--group-by-domain` | Сохранять файлы в поддиректории `<output>/<domain>/` | `false` |
| `-s, --selector <css>` | CSS-селектор контейнера статьи вместо Readability | — |
| `--stdout` | Вывести Markdown в `stdout` (только для одного URL; несовместимо с `-o` и `--download-images`) | `false` |
| `--copy` | Скопировать готовый Markdown в буфер обмена (только для одного URL) | `false` |
| `--no-frontmatter` | Не добавлять YAML frontmatter в начало документа | frontmatter включён |
| `--download-images` | Скачать изображения в `assets/<slug>/` и переписать ссылки на локальные | `false` |
| `-f, --force` | Перезаписывать существующие `.md`-файлы без запроса | `false` |
| `-H, --header <header>` | Дополнительный HTTP-заголовок в формате `"Name: Value"` (можно указывать несколько раз) | `[]` |
| `-A, --user-agent <ua>` | Пользовательский заголовок `User-Agent` | `post2md/0.1.0 (+https://github.com/post2md; Node.js)` |
| `-t, --timeout <ms>` | Таймаут HTTP-запроса в миллисекундах (`1`–`300000`) | `15000` |
| `-c, --concurrency <n>` | Количество параллельных загрузок в пакетном режиме и при скачивании картинок (`1`–`20`) | `3` |
| `--json` | Принудительно выводить JSON-логи Pino в `stderr` вместо TUI | `false` |
| `-v, --verbose` | Подробное логирование (`debug`) в `stderr` | `false` |
| `-q, --quiet` | Логировать только ошибки (`error`) в `stderr` | `false` |
| `-V, --version` | Показать версию утилиты | — |
| `-h, --help` | Показать справку по командам | — |

## Структура проекта

```text
post2md/
├── src/
│   ├── index.ts                      # Точка входа CLI (Commander, парсинг опций, запуск TUI/пайплайна)
│   ├── services/
│   │   ├── fetcher.ts                # HTTP-клиент (fetch, таймауты, ретраи для HTML и бинарных ресурсов)
│   │   ├── extractor.ts              # Парсинг HTML (JSDOM + Readability / CSS-селектор, нормализация img/a)
│   │   ├── assets.ts                 # Параллельное скачивание изображений и перезапись относительных путей
│   │   ├── markdown.ts               # Преобразование HTML -> GFM Markdown (Turndown) и генерация YAML frontmatter
│   │   └── pipeline.ts               # Оркестрация обработки (сбор URL, валидация конфликтов, пул воркеров)
│   ├── ui/
│   │   ├── wizard.ts                 # Интерактивный мастер конфигурации (@clack/prompts)
│   │   └── reporter.ts               # Спиннеры, прогресс-бар, итоговые отчёты и диалог конфликта файлов
│   ├── utils/
│   │   ├── clipboard.ts              # Кросс-платформенное чтение и запись в системный буфер обмена
│   │   ├── logger.ts                 # Конфигурация Pino-логгера (fd 2 / stderr)
│   │   ├── slug.ts                   # Транслитерация кириллицы, генерация slug и рендеринг шаблонов имён
│   │   ├── stdin.ts                  # Разбор текстовых списков URL и чтение stdin
│   │   └── url.ts                    # Валидация HTTP/HTTPS URL, разрешение относительных ссылок и srcset
│   └── types/
│       ├── post.ts                   # Строго типизированные интерфейсы и Zod-схемы опций CLI
│       └── turndown-plugin-gfm.d.ts  # Декларации типов для @joplin/turndown-plugin-gfm
├── tests/
│   ├── fixtures/sample-post.html     # HTML-фикстура для тестов экстрактора
│   ├── extractor.test.ts             # Тесты извлечения контента и метаданных
│   ├── markdown.test.ts              # Тесты конвертации в Markdown и frontmatter
│   ├── pipeline.test.ts              # Интеграционные тесты пайплайна на локальном HTTP-сервере
│   └── slug.test.ts                  # Тесты транслитерации, slug и шаблонов имён
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Скрипты разработки

| Команда | Назначение |
| --- | --- |
| `npm run dev` | Запуск CLI из исходников через `tsx src/index.ts` |
| `npm run build` | Компиляция TypeScript в директорию `dist/` |
| `npm run typecheck` | Проверка типов TypeScript без генерации файлов (`tsc --noEmit`) |
| `npm test` | Однократный запуск тестов (`vitest run`) |
| `npm run test:watch` | Запуск Vitest в режиме отслеживания изменений |
