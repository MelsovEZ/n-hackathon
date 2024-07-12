## Документация

### Обзор
Это приложение на Express.js, использующее Google OAuth 2.0 для аутентификации и выполняющее операции с Google Sheets и Google Drive. 

Приложение парсит данные с таблицы с Google Sheets, скармливает Gemini, берёт ответ от бота и вставляет в другую таблицу.

Оно интегрирует различные библиотеки для аутентификации пользователей, управлению сессиями и обработки данных.

Можно настроить какие данные Gemini выдаст, но надо будет менять промпт. Из-за ограниченного времени не смогли сделать изменения на лету.

### Установка и запуск
Чтобы установить зависимости, необходимые для этого проекта, и запустить, выполните следующую команду:

```bash
npm install
npm start
```

### Функционал
* Полная автоматизация
* Весь функционал работает через Google API.
* Авторизация через Google аккаунт. 
* Парсинг данных каждую минуту с Google Sheets.
* Отправка и получение данных с Gemini.
* Вставка данных в таблицу.
* Используется CRON Jobs

### Конфигурация
Для работы приложения необходимо задать несколько переменных окружения. Создайте файл `.env` в корневом каталоге вашего проекта и добавьте следующие переменные:

```
PORT=3000
MONGODB_URI=your_mongodb_uri
SESSION_SECRET=your_session_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SPREADSHEET_ID=your_spreadsheet_id
RANGE=your_range
TARGET_SPREADSHEET_ID=your_target_spreadsheet_id
TARGET_RANGE=your_target_range
GITHUB_TOKEN=your_github_token
GEMINI_API_KEY=your_gemini_api_key
```
