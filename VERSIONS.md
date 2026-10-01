# Зафиксированные версии

Проверено: **2026-09-26**.

Способ проверки:
- MongoDB-сервер (upcoming/stable): `curl -s https://downloads.mongodb.org/full.json`, поле `versions[].version`, первые записи списка (он отсортирован от новых к старым).
- npm-пакеты: `npm view <package> version dist-tags.latest`.
- Bun: `bun --version`.

| Компонент | Версия | Роль | Проверено командой |
|---|---|---|---|
| MongoDB (upcoming, для `mongodb-memory-server` в тестах по умолчанию) | `9.0.0-rc0` | сервер для рантайм-тестов (CLAUDE.md §4.1) | `curl -s https://downloads.mongodb.org/full.json` — первый элемент `versions[]` |
| MongoDB (stable, `TYPEMO_MONGO=stable`) | `8.3.11` | сервер для рантайм-тестов на стабильной ветке | `curl -s https://downloads.mongodb.org/full.json` — первый нестабильный-free элемент `versions[]` без суффикса `-rc*`/`-alpha*` |
| `mongodb` (драйвер) | `7.6.0` | peerDependency ядра, транспорт (D1) | `npm view mongodb version dist-tags.latest` |
| `bson` | `7.3.3` | peerDependency ядра | `npm view bson version dist-tags.latest` |
| Bun | `1.4.0` | рантайм и тест-раннер репозитория | `bun --version` |
| TypeScript | `6.0.3` | компилятор, версия зафиксирована точно (не `^`) | `npm view typescript version` (запрошена ровно `6.0.3`; `dist-tags.latest` на момент проверки — `7.0.2`, см. примечание ниже) |
| `mongodb-memory-server` | `11.3.0` | подъём `mongod` для тестов (test-kit) | `npm view mongodb-memory-server version dist-tags.latest` |
| `mongoose` | `9.10.2` | devDependency **только test-kit**, для сравнительных тестов (Q-PLAN-2) и как объект анализа (research/REPORT-1) | `npm view mongoose version dist-tags.latest` |
| `zod` | `4.6.5` | devDependency **только test-kit** (решение R16): тесты совместимости Standard Schema (`.parse(schema)`, `~standard` модели); ядро от него не зависит. Проверено 2026-09-28 | `bun pm view zod version` (= `npm view zod version`) |
| `reflect-metadata` | `0.2.2` | dependency ядра: хранилище метаданных декораторов (`reflect-metadata/no-conflict`, глобальный `Reflect` не меняется); `emitDecoratorMetadata` не нужен | `npm view reflect-metadata version dist-tags.latest` |
| `expect-type` | `1.4.0` | dev, тесты типов (`expectTypeOf`) | `npm view expect-type version dist-tags.latest` |
| `@types/bun` | `1.4.2` | dev, типы рантайма Bun | `npm view @types/bun version dist-tags.latest` |
| `@biomejs/biome` | `2.5.14` | dev, линт и форматирование (0.8) | `npm view @biomejs/biome version dist-tags.latest` |
| `@opentelemetry/api` | `1.9.1` | peerDependency (`^1.9.1`) и dev `@venloc/typemo-opentelemetry` (R29). Проверено 2026-09-28 | `npm view @opentelemetry/api version` |
| `@opentelemetry/sdk-trace-base` | `2.11.0` | dev `@venloc/typemo-opentelemetry` (тесты: in-memory exporter). Проверено 2026-09-28 | `npm view @opentelemetry/sdk-trace-base version` |
| `@opentelemetry/sdk-metrics` | `2.11.0` | dev `@venloc/typemo-opentelemetry` (тесты метрик). Проверено 2026-09-28 | `npm view @opentelemetry/sdk-metrics version` |
| `@opentelemetry/context-async-hooks` | `2.11.0` | dev `@venloc/typemo-opentelemetry` (контекст через ALS в тестах, 11.9). Проверено 2026-09-28 | `npm view @opentelemetry/context-async-hooks version` |
| `@opentelemetry/semantic-conventions` | `1.43.0` | dev `@venloc/typemo-opentelemetry` (только константы имён). Проверено 2026-09-28 | `npm view @opentelemetry/semantic-conventions version` |
| `@sentry/core` | `11.1.0` | peerDependency (`^11.1.0`) и dev `@venloc/typemo-sentry` (R29). Проверено 2026-09-28 | `npm view @sentry/core version` |
| `@nestjs/common` | `12.1.2` | peerDependency (`^12.1.2`) и dev `@venloc/typemo-nestjs` (R64: только Nest 12). Проверено 2026-10-01 | `bun pm view @nestjs/common version` |
| `@nestjs/core` | `12.1.2` | peerDependency (`^12.1.2`) и dev `@venloc/typemo-nestjs`. Проверено 2026-10-01 | `bun pm view @nestjs/core version` |
| `@nestjs/testing` | `12.1.2` | dev `@venloc/typemo-nestjs` (тестовые модули). Проверено 2026-10-01 | `bun pm view @nestjs/testing version` |
| `@nestjs/platform-express` | `12.1.2` | dev `@venloc/typemo-nestjs` (e2e на Express; Fastify не поддерживается, R64). Проверено 2026-10-01 | `bun pm view @nestjs/platform-express version` |
| `rxjs` | `7.8.2` | peerDependency (`^7.8.2`) и dev `@venloc/typemo-nestjs` (потоки Nest). Проверено 2026-10-01 | `bun pm view rxjs version` |
| `nestjs/mongoose` (исходники) | `12.0.0`, коммит `4eb727c` | только чтение: `references/nestjs-mongoose`, источник перенесённых тестов (решение 15 плана NestJS). Склонировано 2026-10-01 | `git clone --depth 1 https://github.com/nestjs/mongoose` |

## Примечания

- **TypeScript вышел в мажор 7** (`dist-tags.latest` = `7.0.2` на 2026-09-26). План и CLAUDE.md явно фиксируют TypeScript 6 для проекта, поэтому взята точная версия `6.0.3` — последний релиз в линии 6.x на момент проверки (`npm view typescript versions` подтверждает, что `6.0.3` существует и новее релизов ей не выходило). Переход на TypeScript 7 — отдельное решение пользователя, не в рамках этапа 0.
- `mongodb-memory-server` **не скачивает** бинарь MongoDB на этом этапе: переменная `MONGOMS_DISABLE_POSTINSTALL=1` установлена при `bun install`, чтобы избежать сетевой загрузки ~100–150 МБ до того, как это явно понадобится (этап 1, задача 1.2, уже согласовано пользователем в PLAN, но лишний трафик на этапе 0 не нужен). При первом реальном использовании `MongoHarness` (этап 1) бинарь будет загружен явно.
- Обновлять эту таблицу нужно перед каждым этапом, если с момента последней проверки прошло значительное время, и обязательно перед этапом 2 (бюджет `tsc`) и этапом 1 (версия MongoDB для memory-server).

## Бюджет компилятора v1 (решение E10, 2026-09-26)

Измеряется на тестовом проекте с плотным графом `User ↔ Post ↔ Comment`: с этапа 5 — `packages/test-kit/fixtures/dense-graph` (перенесён из `prototypes/p2-types`), сценарий `all`, скрипт `bun run typecheck:budget` (проверяет все пункты таблицы). Основная метрика для CI — число инстанцирований, потому что оно не зависит от железа.

| Метрика | Бюджет |
|---|---|
| Инстанцирования типов | ≤ 1 000 000 |
| Инстанцирования на цепочку запроса сверх базы | ≤ 10 000 |
| Check time (медиана 3 прогонов) | ≤ 1,0 с |
| Total time | ≤ 1,3 с |
| Память `tsc` | ≤ 400 МБ |
| TS2589 / TS2590 | 0 (жёстко) |
| Самый большой перечисляемый union путей в публичном типе | ≤ 5 000 |

Дополнительно действует правило из CLAUDE.md: рост больше чем на 15% за слой нужно сообщить.

### Изменение бюджета (решение L1, 2026-09-27)

Время меряется **сверх базы** `empty`: цена пользовательского кода в сценарии `all` не больше 0,5 с. Самопроверка исходников библиотеки (`empty`) меряется отдельно, о росте нужно сообщать. Лимиты по инстанцированиям прежние. Замер по собранным `.d.ts` — дополнительный, для сравнения, на этапе 10.

## Перф-сторожа (решение R12, 2026-09-28)

Тесты по времени и памяти лежат в `packages/typemo/test/guards/perf/` и **не входят** в обычный `bun run test` (`--path-ignore-patterns`): на загруженной машине они могут быть нестабильны.

- Запуск: `bun run test:perf` из корня (или из `packages/typemo`). Нужен тот же `mongod`, что и для рантайм-тестов (`TYPEMO_MONGO=stable` — на стабильной ветке).
- Когда: после изменений горячих путей (гидратация, сериализация, populate, конвейер операции, курсор) и перед отчётом этапа, который их трогал. Это не бенчмарк (P10): сторожа сравнивают с lean-чтением или сырым драйвером в том же процессе, с щедрыми порогами, и печатают измеренные отношения (`[perf] …`) — их приводят в отчёте.
- Пороги — решение R4. Падение сторожа — сообщить, а не поднимать порог.
