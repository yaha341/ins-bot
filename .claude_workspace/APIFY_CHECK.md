# Проверка доступных акторов в Apify

## Шаг 1: Проверьте акторы в вашем аккаунте

1. Откройте https://console.apify.com/actors
2. Посмотрите какие акторы там есть
3. Есть ли `instagram-scraper` или `Instagram Scraper`?

## Шаг 2: Добавьте актор

1. Откройте https://apify.com/apify/instagram-scraper
2. Нажмите **Try it for free**
3. Заполните форму (вставьте ссылку на пост)
4. Нажмите **Start**
5. Дождитесь результата

Если актор запустился - значит он добавлен в ваш аккаунт!

## Шаг 3: Узнайте точное имя актора

После запуска актора:
1. Откройте https://console.apify.com/actors/runs
2. Найдите последний запуск
3. Кликните на него
4. Посмотрите URL - там будет что-то типа:
   - `/actors/apify~instagram-scraper/runs/...` 
   - или `/actors/ваш_username~instagram-scraper/runs/...`

**Имя актора** = часть между `/actors/` и `/runs/`

Например:
- `apify/instagram-scraper` 
- или `apify~instagram-scraper` (с тильдой)

## Шаг 4: Или используем ID актора

В URL запуска актора также есть ID:
- Например: `https://console.apify.com/actors/Uz2...ABC/runs/xyz`
- ID актора = `Uz2...ABC`

Можно использовать ID вместо имени.

---

Скажите:
1. Какие акторы видите в https://console.apify.com/actors ?
2. Запустился ли `instagram-scraper` вручную через Try it?
3. Какой URL у последнего запуска актора?
