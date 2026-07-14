# Pairboard

Локальная live-coding доска для ученика и наставника. Решения сохраняются как именованные задачи, участники видят код и Pomodoro в реальном времени, а рабочие пространства отделяют разные курсы и темы.

## Что уже работает

- регистрация и вход по JWT;
- личные рабочие пространства и роли владельца/участника;
- приглашение наставника по ссылке, привязанной к email;
- именованные TypeScript/JavaScript-доски, группы, поиск и сортировка по созданию/изменению;
- Monaco Editor с автосохранением и live-синхронизацией через Socket.IO;
- присутствие участников в комнате;
- общий Pomodoro на уровне рабочего пространства;
- локальный запуск JS/TS в Web Worker с лимитом 2 секунды и выводом `console.log`;
- тёмный адаптивный интерфейс на React + Ant Design.

## Стек и структура

```text
apps/
  api/   Express 5 + Socket.IO + Prisma + PostgreSQL
  web/   React 19 + TypeScript + Vite + Ant Design + Monaco
docker-compose.yml
```

PostgreSQL выбран как основная БД сразу: приглашения, роли и сортировка хорошо ложатся на реляционную модель, а Docker сохраняет одинаковое окружение локально и на будущем сервере. Данные лежат в именованном volume `pairboard_data`, поэтому перезапуск контейнера их не удаляет.

## Локальный запуск

Нужны Node.js 20+ и Docker Desktop (либо локальный PostgreSQL).

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Откройте [http://localhost:5173](http://localhost:5173). API будет доступен на [http://localhost:4000/api/health](http://localhost:4000/api/health).

Демо-аккаунты после `npm run db:seed`:

- `student@pairboard.local` / `pairboard123`
- `teacher@pairboard.local` / `pairboard123`

Они уже состоят в общем пространстве «Алгоритмы · лето».

## Команды

```bash
npm run dev         # web и api одновременно
npm run build       # production-сборка обоих приложений
npm run typecheck   # строгая проверка TypeScript
npm run db:push     # применить Prisma-схему локально
npm run db:seed     # добавить демо-данные
```

## Граница текущего MVP

Редактор синхронизируется по принципу server-authoritative last-write-wins. Для обычной пары ученик/наставник этого достаточно, но перед публичным запуском стоит заменить транспорт текста на CRDT (например, Yjs/Hocuspocus), чтобы корректно объединять одновременные правки в одной строке.

Запуск пользовательского кода сейчас выполняется только в браузерном Web Worker. Для сервера нужен отдельный sandbox-сервис с лимитами CPU/памяти и без доступа к сети — выполнять такой код внутри основного API-процесса нельзя.

Перед деплоем также нужны: refresh-token/HTTP-only cookie, rate limiting, восстановление пароля, email-доставка приглашений, миграции `prisma migrate deploy`, TLS и Redis adapter для Socket.IO при нескольких API-инстансах.
