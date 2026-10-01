# Реестр перенесённых тестов Mongoose

Ведётся по CLAUDE.md §4 (пункт 6) и PLAN.md §6.5 (1.19-1.22). Один перенесённый тест — одна строка.
Правило: при падении теста ожидание не подгоняется, статус `divergence: ...` заводится только после решения
с пользователем и записи в `from-mongoose-to-typemo/DIVERGENCES.md`.

Статусы:
- `pass` — перенесён, логика сохранена, тест зелёный.
- `divergence: <ссылка>` — тест переписан осознанно иначе, см. `from-mongoose-to-typemo/DIVERGENCES.md#<якорь>`.
- `n/a: legacy` — тест опирается на legacy Mongoose API (колбэки, `count`, `remove`, ...) и не переносится; причина указывается в этой же ячейке.

| Источник (файл:строка "название") | Наш файл | Статус |
|---|---|---|
| test/model.test.js:7761 "saves new documents" | packages/typemo/test/ported/demo/insert-and-find.test.ts | pass |
| test/bigint.test.js:12 "is a valid schema type" | packages/typemo/test/ported/bson/bigint.test.ts | pass |
| test/bigint.test.js:25 "casting from strings and numbers" | packages/typemo/test/ported/bson/bigint.test.ts | pass (R25: decimal string → bigint); divergence for non-canonical strings: from-mongoose-to-typemo/DIVERGENCES.md L1-1 |
| test/bigint.test.js:42 "handles cast errors" | packages/typemo/test/ported/bson/bigint.test.ts | pass |
| test/bigint.test.js:108 "is stored as a long in MongoDB" | packages/typemo/test/ported/bson/bigint.test.ts | pass |
| test/bigint.test.js:116 "becomes a bigint with lean using useBigInt64" | packages/typemo/test/ported/bson/bigint.test.ts | pass |
| test/cast.number.test.js:8 "casts a numeric string to a number" | packages/typemo/test/ported/bson/cast-number.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 |
| test/cast.number.test.js:12 "casts a float string to a number" | packages/typemo/test/ported/bson/cast-number.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 |
| test/cast.number.test.js:16 "returns null when given null" | packages/typemo/test/ported/bson/cast-number.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-5 |
| test/cast.number.test.js:20 "returns undefined when given undefined" | packages/typemo/test/ported/bson/cast-number.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-6 |
| test/cast.number.test.js:24 "casts a Number instance to a primitive" | packages/typemo/test/ported/bson/cast-number.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-4 |
| test/cast.number.test.js:28 "throws a plain Error (not AssertionError) for a non-numeric string" | packages/typemo/test/ported/bson/cast-number.test.ts | pass |
| test/cast.number.test.js:45 "throws a plain Error (not AssertionError) for an object" | packages/typemo/test/ported/bson/cast-number.test.ts | pass |
| test/cast.number.test.js:57 "throws a plain Error (not AssertionError) for an array" | packages/typemo/test/ported/bson/cast-number.test.ts | pass |
| test/double.test.js:75 "supports undefined as input" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-6 |
| test/double.test.js:89 "supports null as input" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-5 |
| test/double.test.js:105 "casts from decimal string" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 |
| test/double.test.js:119 "casts from exponential string" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 |
| test/double.test.js:133 "casts from infinite string" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1, L1-13 |
| test/double.test.js:152 "casts from NaN string" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 |
| test/double.test.js:166 "casts from number" | packages/typemo/test/ported/bson/double.test.ts | pass |
| test/double.test.js:178 "casts from bigint" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-7 |
| test/double.test.js:190 "casts from BSON.Long" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-7 |
| test/double.test.js:202 "casts from BSON.Double" | packages/typemo/test/ported/bson/double.test.ts | pass |
| test/double.test.js:214 "casts boolean true to 1" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-2 |
| test/double.test.js:226 "casts boolean false to 0" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-2 |
| test/double.test.js:238 "casts empty string to null" | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-3 |
| test/double.test.js:250 "supports valueOf() function " | packages/typemo/test/ported/bson/double.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-4 |
| test/double.test.js:274 "throws a CastError upon validation" | packages/typemo/test/ported/bson/double.test.ts | pass |
| test/double.test.js:292 "throws a CastError upon validation, even for a single-element or empty array" | packages/typemo/test/ported/bson/double.test.ts | pass |
| test/double.test.js:380 "is queryable as a JS number in MongoDB" | packages/typemo/test/ported/bson/double.test.ts | pass |
| test/double.test.js:387 "is NOT queryable as a BSON Integer in MongoDB if the value is NOT integer" | packages/typemo/test/ported/bson/double.test.ts | pass |
| test/double.test.js:393 "is queryable as a BSON Double in MongoDB when a non-integer is provided" | packages/typemo/test/ported/bson/double.test.ts | pass |
| test/double.test.js:399 "is queryable as a BSON Double in MongoDB when an integer is provided" | packages/typemo/test/ported/bson/double.test.ts | pass |
| test/int32.test.js:78 "supports INT32_MIN as input" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:92 "supports INT32_MAX as input" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:106 "supports undefined as input" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-6 |
| test/int32.test.js:120 "supports null as input" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-5 |
| test/int32.test.js:136 "casts from string" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 |
| test/int32.test.js:150 "casts from number" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 |
| test/int32.test.js:162 "casts from bigint" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-7 |
| test/int32.test.js:174 "casts from BSON.Int32" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:191 "casts from BSON.Long provided its value is within bounds of Int32" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-7 |
| test/int32.test.js:203 "calls Long.toNumber when casting long" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-7 |
| test/int32.test.js:222 "casts from BSON.Double provided its value is an integer" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-7 |
| test/int32.test.js:234 "casts boolean true to 1" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-2 |
| test/int32.test.js:246 "casts boolean false to 0" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-2 |
| test/int32.test.js:258 "casts empty string to null" | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-3 |
| test/int32.test.js:270 "supports valueOf() function " | packages/typemo/test/ported/bson/int32.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-4 |
| test/int32.test.js:294 "throws a CastError upon validation" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:312 "throws a CastError upon validation" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:330 "throws a CastError upon validation" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:348 "throws a CastError upon validation" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:366 "throws a CastError upon validation" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:384 "throws a CastError upon validation" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:402 "throws a CastError upon validation, even for a single-element or empty array" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:490 "is queryable as a JS number in MongoDB" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:497 "is queryable as a BSON Int32 in MongoDB" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/int32.test.js:504 "is NOT queryable as a BSON Double in MongoDB" | packages/typemo/test/ported/bson/int32.test.ts | pass |
| test/schema.date.test.js:19 "accepts a Date" | packages/typemo/test/ported/bson/schema-date.test.ts | pass |
| test/schema.date.test.js:25 "casts a date string to a string" | packages/typemo/test/ported/bson/schema-date.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-8 |
| test/schema.date.test.js:30 "interprets a number as a unix timestamp" | packages/typemo/test/ported/bson/schema-date.test.ts | pass (I1; was divergence L1-8) |
| test/schema.date.test.js:35 "attempts to interpret a string as a Date, not a timestamo (gh-5395)" | packages/typemo/test/ported/bson/schema-date.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-8 |
| test/schema.date.test.js:40 "casts any object with a `.valueOf` function to a date" | packages/typemo/test/ported/bson/schema-date.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-4 |
| test/schema.date.test.js:47 "casts string representation of unix timestamps (gh-6443)" | packages/typemo/test/ported/bson/schema-date.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-8 |
| test/schema.union.test.js:27 "basic functionality should work" | packages/typemo/test/ported/bson/schema-union.test.ts | pass |
| test/schema.union.test.js:51 "should report last cast error" | packages/typemo/test/ported/bson/schema-union.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-11 |
| test/schema.union.test.js:162 "does not bypass validation when a Union of Objects is used (gh-15732)" | packages/typemo/test/ported/bson/schema-union.test.ts | pass |
| test/schema.uuid.test.js:36 "basic functionality should work" | packages/typemo/test/ported/bson/schema-uuid.test.ts | pass |
| test/schema.uuid.test.js:64 "should throw error in case of invalid string" | packages/typemo/test/ported/bson/schema-uuid.test.ts | pass |
| test/schema.uuid.test.js:175 "handles built-in UUID type (gh-13103)" | packages/typemo/test/ported/bson/schema-uuid.test.ts | pass |
| test/types.array.test.js:1054 "castNonArrays (gh-7371) (gh-7479)" | packages/typemo/test/ported/bson/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-12 |
| test/types.buffer.test.js:394 "retains custom subtypes" | packages/typemo/test/ported/bson/types-buffer.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-10 |
| test/types.buffer.test.js:410 "default value" | packages/typemo/test/ported/bson/types-buffer.test.ts | pass |
| test/types.buffer.test.js:447 "cast from number (gh-3764)" | packages/typemo/test/ported/bson/types-buffer.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-10 |
| test/types.buffer.test.js:456 "cast from string" | packages/typemo/test/ported/bson/types-buffer.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-10 |
| test/types.buffer.test.js:466 "cast from array" | packages/typemo/test/ported/bson/types-buffer.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-10 |
| test/types.buffer.test.js:476 "cast from Binary" | packages/typemo/test/ported/bson/types-buffer.test.ts | pass |
| test/types.buffer.test.js:486 "cast from json (gh-6863)" | packages/typemo/test/ported/bson/types-buffer.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-10 |
| test/types.decimal128.test.js:19 "casts from type number (gh-6331)" | packages/typemo/test/ported/bson/types-decimal128.test.ts | pass (I1; was divergence L1-9) |
| test/types.decimal128.test.js:31 "uses valueOf method if one exists (gh-6418)" | packages/typemo/test/ported/bson/types-decimal128.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-4 |
| test/types.number.test.js:18 "an empty string casts to null" | packages/typemo/test/ported/bson/types-number.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-3 |
| test/types.number.test.js:30 "array throws cast number error" | packages/typemo/test/ported/bson/types-number.test.ts | pass |
| test/types.number.test.js:42 "three throws cast number error" | packages/typemo/test/ported/bson/types-number.test.ts | pass |
| test/types.number.test.js:54 "{} throws cast number error" | packages/typemo/test/ported/bson/types-number.test.ts | pass |
| test/types.number.test.js:66 "does not throw number cast error" | packages/typemo/test/ported/bson/types-number.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1, L1-3, L1-4, L1-5 |
| test/types.number.test.js:81 "boolean casts to 0/1 (gh-3475)" | packages/typemo/test/ported/bson/types-number.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-2 |
| test/types.number.test.js:88 "prefers valueOf function if one exists (gh-6299)" | packages/typemo/test/ported/bson/types-number.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-4 |
| test/int32.test.js:423 "supports cast disabled" | — (no global caster override in Typemo) | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-14 |
| test/int32.test.js:446 "supports custom cast" | — (no global caster override in Typemo) | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-14 |
| test/double.test.js:313 "supports cast disabled" | — (no global caster override in Typemo) | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-14 |
| test/double.test.js:336 "supports custom cast" | — (no global caster override in Typemo) | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-14 |
| test/types.number.test.js:137 "disallow empty string" | — (no global caster override in Typemo) | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-14 |
| test/types.number.test.js:156 "disable casting" | — (no global caster override in Typemo) | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-14 |
| test/schematype.cast.test.js:28–201 "SchemaType.cast() (gh-7045)" (10 tests) | — (no global caster override in Typemo) | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-14 |

### Этап 3: найдены, но относятся к следующим слоям (не перенесены сейчас)

Кандидаты из `test/cast.test.js`, `test/int32.test.js`, `test/double.test.js`, `test/bigint.test.js`,
`test/schema.uuid.test.js`, `test/schema.union.test.js`, `test/types.number.test.js`, которые проверяют
каст фильтра/update, операторы запроса, populate, setters, `toJSONSchema` или модель. Переносятся на
этапах 4 (схема) и 6 (конвейер, каст фильтра и update):

| Источник | Почему не на этапе 3 | Этап |
|---|---|---|
| test/cast.test.js (все 21 тест: `$in`, `$all`/`$elemMatch`, geo, `$bits*`, `$expr`, strictQuery, `$comment`, discriminators) | каст фильтра запроса | 6 |
| test/int32.test.js:30,31,53 (required), :511 (comparison operators), :528 (populate) | required — валидация; операторы и populate — запрос | 4, 6, 8 |
| test/double.test.js:27,28,50, :406, :423 | то же | 4, 6, 8 |
| test/bigint.test.js:63 (required), :127 (comparison operators), :144 (populate) | то же | 4, 6, 8 |
| test/types.number.test.js:24 (castForQuery null), :103 (unsupported operator gh-16062), :115 (bad conditional gh-6927) | каст фильтра | 6 |
| test/schema.uuid.test.js:75 ($in/$nin/$all), :113 (gh-13032 default), :139 (populate), :160 (lean), :197 (maps of uuids gh-13657), :228 ($bits*), :259 ($all) | запрос, дефолты, populate, Map-документ | 4, 6, 8 |
| test/schema.union.test.js:68 (cast for query), :92 (cast updates), :112 (setters), :139 (arrays of unions gh-15718 в документе), :213 (toJSONSchema) | запрос, update, setters, JSON Schema | 4, 6 |
| test/types.buffer.test.js:57–383 (MongooseBuffer API, markModified, set/update to null) | документ и change tracking | 7 |

### Этап 4: схема (L2)

Тесты найдены через `scripts/port/find-mongoose-tests.ts` и чтением файлов `test/schema*.test.js`, `test/model.indexes.test.js`, `test/model.discriminator.test.js`, `test/index.test.js`, `test/utils.test.js`. Документные и модельные части (create/save/find) — этапы 6–7: здесь логика проверяется на скомпилированной схеме, индексы и валидаторы — на реальном сервере.

| Источник (файл:строка "название") | Наш файл | Статус |
|---|---|---|
| test/model.discriminator.test.js:182 "sets schema root discriminator mapping" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:187 "sets schema discriminator type mapping" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:192 "adds discriminatorKey to schema with default as name" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:198 "adds discriminator to Model.discriminators object" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:216 "throws error when attempting to nest discriminators" | packages/typemo/test/ported/schema/discriminator.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-9 |
| test/model.discriminator.test.js:225 "throws error when discriminator has mapped discriminator key in schema" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:244 "throws error when discriminator with taken name is added" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:320 "inherits field mappings" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:326 "inherits validators" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:332 "does not inherit and override fields that exist" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:343 "allows discriminator schema to override required true with required false and allowNull false" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:381 "inherits methods" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:400 "does not inherit indexes" | packages/typemo/test/ported/schema/discriminator.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-9 |
| test/model.discriminator.test.js:408 "gets options overridden by root options except toJSON and toObject" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:420 "does not allow setting discriminator key (gh-2041)" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:434 "deduplicates hooks (gh-2945)" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:716 "incorrect discriminator key throws readable error with create (gh-6434)" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:1041 "embedded in document arrays (gh-2723)" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:1095 "embedded with single nested subdocs (gh-5244)" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:1212 "Embedded discriminators in nested doc arrays (gh-6202)" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:1566 "merges schemas instead of overwriting (gh-7884)" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:2456 "does not duplicate _indexes when base and discriminator schemas share nested schema (gh-15966)" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:2503 "preserves discriminator-specific indexes (gh-15966)" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/model.discriminator.test.js:1394 "should copy plugins" | packages/typemo/test/ported/schema/discriminator.test.ts | pass |
| test/schema.test.js:759 "basic" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/schema.test.js:824 "compound" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/schema.test.js:846 "compound based on name (gh-6499)" | packages/typemo/test/ported/schema/indexes.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-5 |
| test/schema.test.js:859 "using \"ascending\" and \"descending\" for order (gh-13725)" | packages/typemo/test/ported/schema/indexes.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-5 |
| test/schema.test.js:874 "with single nested doc (gh-6113)" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/schema.test.js:893 "with embedded discriminator (gh-6485)" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:36 "are created when model is compiled" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:71 "of embedded documents" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:107 "of embedded documents unless excludeIndexes (gh-5575) (gh-8343)" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:141 "of multiple embedded documents with same schema" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:186 "compound: on embedded docs" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:218 "nested embedded docs (gh-5199)" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:246 "primitive arrays (gh-3347)" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:316 "creates descending indexes from schema definition(gh-8895)" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:419 "sets correct partialFilterExpression for document array (gh-9091)" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:461 "converts to partial unique index (gh-6347)" | packages/typemo/test/ported/schema/indexes.test.ts | pass |
| test/model.indexes.test.js:514 "uses schema-level collation by default (gh-9912)" | packages/typemo/test/ported/schema/indexes.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-6 |
| test/schema.test.js:3749 "handles basic example with only top-level keys" | packages/typemo/test/ported/schema/json-schema.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-8 |
| test/schema.test.js:3937 "handles all primitive data types" | packages/typemo/test/ported/schema/json-schema.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-8 |
| test/schema.test.js:4040 "handles arrays and document arrays" | packages/typemo/test/ported/schema/json-schema.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-8 |
| test/schema.test.js:4097 "handles nested paths and subdocuments" | packages/typemo/test/ported/schema/json-schema.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-8 |
| test/schema.test.js:4172 "handles maps" | packages/typemo/test/ported/schema/json-schema.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-8 |
| test/schema.test.js:4378 "handles required enums" | packages/typemo/test/ported/schema/json-schema.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-8 |
| test/schema.test.js:4438 "puts enums on array elements rather than on the array (gh-16443)" | packages/typemo/test/ported/schema/json-schema.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-8 |
| test/schema.test.js:4497 "supports enums declared as an object or set with enum() (gh-16443)" | packages/typemo/test/ported/schema/json-schema.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-8 |
| test/index.test.js:41 "legacy pluralize by default (gh-5958)" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/index.test.js:49 "returns legacy pluralize function by default" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/index.test.js:58 "sets custom pluralize function (gh-5877)" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/utils.test.js:375 "returns the same name for system.profile" | packages/typemo/test/ported/schema/naming-paths.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-7 |
| test/utils.test.js:383 "throws an error when name is not a string" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/utils.test.js:389 "throws an error when name is an empty string" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/utils.test.js:395 "uses the pluralize function when provided" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/schema.pathType.test.js:7 "treats inherited properties as adhoc or undefined" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/schema.pathType.test.js:16 "gets paths underneath maps" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/schema.pathType.test.js:28 "gets paths underneath maps of subdocuments" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/schema.pathType.test.js:43 "treats inherited properties underneath maps of subdocuments as adhoc or undefined" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/schema.pathType.test.js:58 "gets paths underneath maps of maps" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/schema.alias.test.js:29 "works with all basic schema types" | packages/typemo/test/ported/schema/naming-paths.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L2-4 |
| test/schema.alias.test.js:103 "throws when alias option is invalid" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/schema.alias.test.js:121 "nested aliases (gh-6671)" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/schema.alias.test.js:186 "supports passing the alias name for an index (gh-13276)" | packages/typemo/test/ported/schema/naming-paths.test.ts | pass |
| test/schema.alias.test.js:198 "should disable the id virtual entirely if there's a field with alias `id` gh-13650" | packages/typemo/test/ported/schema/naming-paths.test.ts | n/a: no id virtual in Typemo (H419), logic checked |

#### Этап 4: найдены, но относятся к следующим этапам

| Источник | Почему не сейчас | Этап |
|---|---|---|
| test/model.discriminator.test.js (≈75 остальных: create/save/find/populate/update, `$push` в embedded, проекции, `clone()`, `mergeHooks`/`mergePlugins`) | модель, документ, запросы; `clone()`/`mergeHooks` — API, которого в Typemo нет | 6–8 |
| test/model.indexes.test.js:257, :278, :334–401, :497–718 (ошибки `init()`, autoIndex, `ensureIndexes`, `syncIndexes`/`diffIndexes`/`cleanIndexes`, `dryRun`) | синхронизация индексов с сервером (D22) | 9 |
| test/schema.test.js (≈190 остальных: `add/remove/pick/omit/clone`, `path()` API, typeKey, Mixed, `loadClass`, virtual API, timestamps опцией, `toJSONSchema` в JSON-варианте для Ajv) | API построения схемы объектами, которого в Typemo нет, или документ/модель | n/a или 6–7 |
| test/schema.validation.test.js (64), test/schema.string.test.js, test/schema.number.test.js | валидация документа (`validate()`/`validateSync`), сообщения `{PATH}` — L5 | 7 |
| test/schema.subdocumentpath.test.js, test/schema.documentarray.test.js | поведение поддокументов в документе | 7 |
| test/timestamps.test.js | заполнение `createdAt`/`updatedAt` ядром | 7 |
| test/virtualtype.test.js, test/model.populate*.test.js | populate-виртуалы | 8 |

### Этап 5B — агрегация (pipeline-билдер)

| Источник (файл:строка "название") | Наш файл | Статус |
|---|---|---|
| test/aggregate.test.js:186 "works" (group) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:198 "works" (skip) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:210 "works" (limit) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:222 '("field")' (unwind) | packages/typemo/test/ported/aggregate/aggregate.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3B-4 (один путь `"$field"` на вызов, без авто-`$`) |
| test/aggregate.test.js:239 "works" (match) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:251 "(object)" (sort) | packages/typemo/test/ported/aggregate/aggregate.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3B-1 (только `1`/`-1`/`$meta`) |
| test/aggregate.test.js:261 "(string)" (sort) | — | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3B-1 (строковый DSL, D28) |
| test/aggregate.test.js:271 '("a","b","c")', :278 '["a","b","c"]' (sort) | — (тип) | pass: неверная форма — ошибка компиляции |
| test/aggregate.test.js:150 "(object)", :160 "(string)", :170, :177 (project) | packages/typemo/test/ported/aggregate/aggregate.test.ts / — | pass (объект); строки — divergence L3B-1 |
| test/aggregate.test.js:91, :101, :111, :132, :140 (append) | — | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3B-2 (нет сырых стадий) |
| test/aggregate.test.js:287 "works" (near) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass (второй `$geoNear` — ошибка типа: сервер требует первую стадию) |
| test/aggregate.test.js:300 "works with discriminators (gh-3304)" | — | n/a: этап 6 (цель плана хранит `discriminator`, фильтр добавляет исполнение) |
| test/aggregate.test.js:331 "works" (lookup) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass (`from` — сущность) |
| test/aggregate.test.js:348 "works" (unionWith) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:367 "works" (sample) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:378 "works" (densify) | test/runtime/aggregate/stages.test.ts | pass (даты: `unit` обязателен по типу) |
| test/aggregate.test.js:397 "works" (fill) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:416 "works" (model()) | — | n/a: legacy (привязка модели к Aggregate; источник задаётся при создании) |
| test/aggregate.test.js:431 "works" (redact) | packages/typemo/test/ported/aggregate/aggregate.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3B-3 (`Vars.PRUNE` вместо строк) |
| test/aggregate.test.js:442 "works with (condition, string, string)" | — | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3B-3 |
| test/aggregate.test.js:455 "works", :473 "automatically prepends $ to the startWith field" (graphLookup) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass (`startWith` — выражение) |
| test/aggregate.test.js:484 "Throws if no options are passed to graphLookup" | — (тип) | pass: ошибка компиляции |
| test/aggregate.test.js:494, :498, :502 (addFields throws) | — (тип) | pass: ошибка компиляции |
| test/aggregate.test.js:506 "(object)" (addFields) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:518 "works" (facet) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:564 "works with a string", :572 "works with an object (gh-6474)" (replaceRoot) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:583 "works" (count) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:593, :601 (sortByCount) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:610 "throws if the argument is neither a string or object" | — (тип) | pass: ошибка компиляции |
| test/aggregate.test.js:625 "project", :636 "group", :650 "skip", :660 "limit", :670 "unwind" (exec) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:680 "unwind with obj" | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:691 "unwind throws with bad arg" | — (тип) | pass: ошибка компиляции |
| test/aggregate.test.js:705 "match", :713 "sort" (exec) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:721 "graphLookup" (exec) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:754 "facet" (exec) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:792 "complex pipeline" | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:808 "pipeline() (gh-5825)" | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass (`build()`) |
| test/aggregate.test.js:818, :828 (pipelineForUnionWith) | test/types/aggregate/stages.test-d.ts | pass: в подпайплайне нет `out`/`merge` (тип) |
| test/aggregate.test.js:849 "without a callback" (empty pipeline) | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass (тип + рантайм `ConfigurationError`) |
| test/aggregate.test.js:836 explain, :863 not bound, :876 options, :903–:1071 middleware/readPref, :1083–:1218 cursor, :1255 transform, :1308 | — | n/a: этап 6 (исполнение, хуки, курсоры) |
| test/aggregate.test.js:1225 "query by document (gh-4866)" | — | n/a: этап 6 (`$match` документом — каст фильтра) |
| test/aggregate.test.js:1235 "sort by text score (gh-5258)" | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/aggregate.test.js:1286 "adds hint option" | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass (hint проверяется по индексам схемы) |
| test/aggregate.test.js:1324 "throws error if calling near() with empty coordinates (gh-15188)" | — (тип) | pass: `near` — кортеж `[number, number]` или GeoJSON-точка |
| test/model.aggregate.test.js:75 "with Aggregate syntax" | packages/typemo/test/ported/aggregate/aggregate.test.ts | pass |
| test/model.aggregate.test.js:60–:102 (массив стадий, exec, Aggregate instance), :115 $out | — | n/a: этап 6 (`Model.aggregate`); `$out` — test/runtime/aggregate/stages.test.ts |
| test/model.discriminator.querying.test.js:1016, :1031 (aggregate discriminators) | — | n/a: этап 6 (фильтр дискриминатора при исполнении) |
| test/schema.select.test.js:28 "excluding paths through schematype" | packages/typemo/test/ported/query/select.test.ts | pass (`isSelected` — этап 7) |
| test/schema.select.test.js:69 "including paths through schematype" | — | n/a: `select: true` в схеме не переносится (нет опции; обычное поле) |
| test/schema.select.test.js:301 "forcing inclusion of a deselected schema path works" | packages/typemo/test/ported/query/select.test.ts | pass (строковый DSL → объект, L3Q-2) |
| test/schema.select.test.js:351 "works if only one plus path and only one deselected field" | packages/typemo/test/runtime/query/reads.test.ts ("`+field` adds a Hidden field…") | pass |
| test/schema.select.test.js:364 "works with query.slice (gh-1370)" | packages/typemo/test/ported/query/select.test.ts | pass |
| test/schema.select.test.js:375 "ignores if path does not have select in schema (gh-6785)" | packages/typemo/test/ported/query/select.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3Q-4 |
| test/schema.select.test.js:388 "omits if not in schema (gh-7017)" | packages/typemo/test/ported/query/select.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3Q-4 |
| test/schema.select.test.js:411 "conflicting schematype path selection should not error" | packages/typemo/test/ported/query/select.test.ts | pass |
| test/schema.select.test.js:432 "selecting _id works with excluded schematype path" (+ :441 on sub doc) | packages/typemo/test/ported/query/select.test.ts | pass |
| test/schema.select.test.js:450 "inclusive/exclusive combos should work" | packages/typemo/test/ported/query/select.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3Q-3 (смешение — ошибка до запроса) |
| test/schema.select.test.js:491 "when select is false in the schema definition, all inclusive/exclusive combos should work" | packages/typemo/test/ported/query/select.test.ts | pass |
| test/schema.select.test.js:538 "when select is set to true in the schema definition…" | — | n/a: нет опции `select: true` (L3Q-4) |
| test/query.test.js:82 "should not overwrite fields set in prior calls" | packages/typemo/test/ported/query/select.test.ts | pass |
| test/helpers/projection.isExclusive.test.js:9 / isInclusive.test.js:9 "handles $elemMatch (gh-14893)" | packages/typemo/test/ported/query/select.test.ts | pass |
| test/query.test.js:540, :546, :552 "slice …" | packages/typemo/test/ported/query/select.test.ts | pass (через проекцию, без `where().slice()`: D28) |
| test/query.test.js:525, :531 "size via where / not via where" | packages/typemo/test/ported/query/writes.test.ts | pass |
| test/query.test.js:672 "limit works", :679 "with string limit (gh-11017)" | packages/typemo/test/ported/query/writes.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3Q-7 |
| test/query.test.js:837 "doesn't wipe out $in (gh-6439)" | packages/typemo/test/ported/query/writes.test.ts | pass |
| test/query.test.js:875, :919, :932, :976, :989 (cast of array operators) | — | n/a: каст значений фильтра — этап 6 |
| test/query.test.js:1133 "should retain key order" | packages/typemo/test/ported/query/writes.test.ts | pass |
| test/model.findOneAndUpdate.test.js:88 "returns the edited document" | packages/typemo/test/ported/query/writes.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3Q-1 |
| test/model.findOneAndUpdate.test.js:160 "preserves own __proto__ keys in update payloads … (gh-16202)" | packages/typemo/test/ported/query/writes.test.ts | pass (уровень плана; Mixed нет) |
| test/model.findOneAndUpdate.test.js:180 "does not mutate the caller update when chaining set() …" | packages/typemo/test/ported/query/writes.test.ts | pass (`set()` у запроса нет: билдер не меняет вход) |
| test/model.findOneAndUpdate.test.js:279 "returns the original document" | packages/typemo/test/ported/query/writes.test.ts | pass |
| test/model.findOneAndUpdate.test.js:688 "returns null when doing an upsert & new=false gh-1533" | packages/typemo/test/ported/query/writes.test.ts | pass (`returnDocument: "before"`, H059) |
| test/model.findOneAndUpdate.test.js:726 "return includeResultMetadata when doing an upsert & new=false gh-7770" | packages/typemo/test/ported/query/writes.test.ts | pass |
| test/model.findOneAndUpdate.test.js:748 "allows properties to be set to null gh-1643" | packages/typemo/test/ported/query/writes.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3Q-6 |
| test/model.findOneAndUpdate.test.js:871 "accepts undefined" | packages/typemo/test/ported/query/writes.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L3Q-5 |
| test/helpers/update.castArrayFilters.test.js:64 "sane error on same filter twice" | packages/typemo/test/ported/query/writes.test.ts | pass |
| test/helpers/update.castArrayFilters.test.js:83 "using $in (gh-7431)" | packages/typemo/test/ported/query/writes.test.ts | pass (каст строк → этап 6) |
| test/helpers/update.castArrayFilters.test.js:108 "all positional operator works (gh-7540)" | packages/typemo/test/ported/query/writes.test.ts | pass |
| test/helpers/update.castArrayFilters.test.js:128 "handles deeply nested arrays (gh-7603)" | packages/typemo/test/ported/query/writes.test.ts | pass |
| test/helpers/update.castArrayFilters.test.js:154, :182 (strictQuery / strict override) | — | n/a: опций ослабления нет (D9); строгость — этап 6 |
| test/helpers/query.sanitizeFilter.test.js:8 "throws when filter includes a query selector" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | pass (тот же исход по другой причине: `$ne: null` на не-nullable пути — CastError) |
| test/helpers/query.sanitizeFilter.test.js:19 "ignores explicitly defined query selectors" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | divergence: DIVERGENCES L4B-1 (J3: селекторы, написанные приложением, сохраняются; данные извне — `untrusted()`; этап 10) |
| test/helpers/query.sanitizeFilter.test.js:29 "handles $and, $or, $nor" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | divergence: DIVERGENCES L4B-1 (J3: `{ pwd: { $ne } }` приложения — фильтр; внутри `untrusted()` — ошибка; этап 10) |
| test/helpers/query.sanitizeFilter.test.js:43 "handles $not" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | divergence: DIVERGENCES L4B-1 (J3; этап 10) |
| test/helpers/query.sanitizeFilter.test.js:49 "handles $jsonSchema" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | divergence: DIVERGENCES L4B-1 (J3: `$jsonSchema` — типизированный корневой оператор; внутри `untrusted()` — ошибка; этап 10) |
| test/helpers/query.sanitizeFilter.test.js:73 "handles $where" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | pass (trusted-функция `$where` тоже отвергается: D3) |
| test/helpers/query.sanitizeFilter.test.js:87 "handles $expr" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | pass (отвергается `$function`; `$expr` без JS — типизированный, D30) |
| test/helpers/query.sanitizeFilter.test.js:104 "handles $text" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | divergence: DIVERGENCES L4B-1 (J3: `$text` — типизированный корневой оператор; внутри `untrusted()` — ошибка; этап 10) |
| test/query.test.js:3512 "sanitizeFilter option (gh-3944)" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | pass (часть с `trusted()` — n/a) |
| test/query.test.js:3533 "sanitizeFilter disables implicit $in (gh-14657)" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | pass |
| test/model.countDocuments.test.js:37 "applies sanitizeFilter (gh-15720)" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | pass (часть с `trusted()` — n/a) |
| test/model.countDocuments.test.js:60 "sanitizeFilter rejects $where (gh-15720)" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | pass |
| test/model.countDocuments.test.js:70 "applies sanitizeFilter set on the connection (gh-15720)" | — | n/a: опции нет, политика всегда включена (D9) |
| test/query.cursor.test.js:997 "applies sanitizeFilter (gh-15720)" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | pass |
| test/query.cursor.test.js:1009 "sanitizeFilter allows trusted operators (gh-15720)" | — | n/a: `trusted()` нет (вопрос 1 отчёта 06b) |
| test/query.cursor.test.js:1019 "sanitizeFilter rejects $where (gh-15720)" | packages/typemo/test/ported/steps/sanitize-filter.test.ts | pass |
| test/helpers/update.castArrayFilters.test.js:10 "works" | packages/typemo/test/ported/steps/cast-update.test.ts | pass (каст этапа 6) |
| test/helpers/update.castArrayFilters.test.js:23 "casts multiple" | packages/typemo/test/ported/steps/cast-update.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 (123 на строковом пути не становится '123', D8) |
| test/helpers/update.castArrayFilters.test.js:41 "casts on multiple fields" | packages/typemo/test/ported/steps/cast-update.test.ts | pass |
| test/helpers/update.castArrayFilters.test.js:64 "sane error on same filter twice" | packages/typemo/test/ported/steps/cast-update.test.ts | pass |
| test/helpers/update.castArrayFilters.test.js:108 "all positional operator works (gh-7540)" | packages/typemo/test/ported/steps/cast-update.test.ts | pass (каст этапа 6) |
| test/helpers/update.castArrayFilters.test.js:128 "handles deeply nested arrays (gh-7603)" | packages/typemo/test/ported/steps/cast-update.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 ('2' не становится 2, D8) |
| test/helpers/update.castArrayFilters.test.js:205 "respects `$or` option (gh-10696)" | packages/typemo/test/ported/steps/cast-update.test.ts | pass (+ неизвестный путь в `$or` — StrictModeError) |
| test/helpers/update.applyTimestampsToUpdate.test.js:7 "handles update pipelines (gh-11151)" | packages/typemo/test/ported/steps/cast-update.test.ts | pass (timestamps — от `Timestamped`, D13) |
| test/helpers/update.applyTimestampsToUpdate.test.js:16 "does not set createdAt unless upsert is enabled" | packages/typemo/test/ported/steps/cast-update.test.ts | pass |
| test/model.updateOne.test.js:1648 "single nested with runValidators (gh-4420)" | packages/typemo/test/ported/steps/cast-update.test.ts | pass (валидаторы update всегда включены) |
| test/model.updateOne.test.js:1666 "single nested under doc array with runValidators (gh-4960)" | packages/typemo/test/ported/steps/cast-update.test.ts | pass (+ отсутствие required-поддокумента — ValidationError) |
| test/model.findOneAndUpdate.test.js:1932 "$pull with `required` and runValidators (gh-6972)" | packages/typemo/test/ported/steps/cast-update.test.ts | pass |
| test/model.updateOne.test.js:1357 "versioning with setDefaultsOnInsert (gh-2593)" | packages/typemo/test/ported/steps/cast-update.test.ts | pass |
| test/model.test.js:4616 "setDefaultsOnInsert (gh-5708)" | packages/typemo/test/ported/steps/cast-update.test.ts | pass (bulkWrite через те же шаги) |
| test/helpers/query.castUpdate.test.js:42–106 (пути-модификаторы `$each`…) | — | n/a: имя поля с `$` в Typemo невозможно (имя свойства класса; `dbName` не начинается с `$`) |

### Этап 6A (L0 + L4: соединение, модель, исполнение, курсоры, транзакции)

Источники: `test/docs/transactions.test.js`, `test/model.insertMany.test.js`, `test/query.cursor.test.js`,
`test/connection.test.js`, `test/model.test.js`. Нашлись поиском `scripts/port/find-mongoose-tests.ts`
(transaction, insertMany, cursor, eachAsync, bulkWrite, syncIndexes, useDb) и чтением файлов.

| Источник (файл:строка "название") | Наш файл | Статус |
|---|---|---|
| test/model.insertMany.test.js:215 "insertMany() (gh-723)" | packages/typemo/test/ported/model/insert-many.test.ts | pass |
| test/model.insertMany.test.js:235 "insertMany() ordered option for constraint errors (gh-3893)" | packages/typemo/test/ported/model/insert-many.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L4A-2 |
| test/model.insertMany.test.js:311 "insertMany() ordered option for validation errors (gh-5068)" | packages/typemo/test/ported/model/insert-many.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L4A-1 |
| test/model.insertMany.test.js:337 "insertMany() `writeErrors` if only one error (gh-8938)" | packages/typemo/test/ported/model/insert-many.test.ts | pass |
| test/model.insertMany.test.js:378 "insertMany() ordered option for single validation error" | packages/typemo/test/ported/model/insert-many.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L4A-1 |
| test/model.insertMany.test.js:402 "insertMany() hooks (gh-3846)" | packages/typemo/test/ported/model/insert-many.test.ts | pass |
| test/model.insertMany.test.js:433 "returns empty array if no documents (gh-8130)" | packages/typemo/test/ported/model/insert-many.test.ts | pass |
| test/model.insertMany.test.js:438 "insertMany() multi validation error with ordered false (gh-5337)" | packages/typemo/test/ported/model/insert-many.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L4A-1 |
| test/model.insertMany.test.js:457 "insertMany() validation error with ordered true when all documents are invalid" | packages/typemo/test/ported/model/insert-many.test.ts | pass |
| test/model.insertMany.test.js:818 "insertMany with Decimal (gh-5190)" | packages/typemo/test/ported/model/insert-many.test.ts | pass |
| test/model.insertMany.test.js:869 "insertMany() should throw when pre-hook throws an error" | packages/typemo/test/ported/model/insert-many.test.ts | pass |
| test/model.insertMany.test.js:882 "insertMany() should not insert documents when pre-hook throws" | packages/typemo/test/ported/model/insert-many.test.ts | pass |
| test/model.insertMany.test.js:895 "insertMany() should call error post hook when pre-hook throws" | packages/typemo/test/ported/model/insert-many.test.ts | pass |
| test/docs/transactions.test.js:44 "basic example" | packages/typemo/test/ported/model/transactions.test.ts | pass |
| test/docs/transactions.test.js:75 "withTransaction" | packages/typemo/test/ported/model/transactions.test.ts | pass |
| test/docs/transactions.test.js:95 "abort" | packages/typemo/test/ported/model/transactions.test.ts | pass |
| test/docs/transactions.test.js:168 "aggregate" | packages/typemo/test/ported/model/transactions.test.ts | pass |
| test/docs/transactions.test.js:291 "deleteOne and deleteMany (gh-7857)(gh-6805)" | packages/typemo/test/ported/model/transactions.test.ts | pass |
| test/docs/transactions.test.js:341 "distinct (gh-8006)" | packages/typemo/test/ported/model/transactions.test.ts | pass |
| test/docs/transactions.test.js:389 "transaction() sets `session` by default if transactionAsyncLocalStorage option is set" | packages/typemo/test/ported/model/transactions.test.ts | pass |
| test/docs/transactions.test.js:709 "doesnt apply schema write concern to transaction operations (gh-11382)" | packages/typemo/test/ported/model/transactions.test.ts | pass |
| test/docs/transactions.test.js:754 "throws error if using `create()` with multiple docs in a transaction (gh-15091)" | packages/typemo/test/ported/model/transactions.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L4A-3 |
| test/query.cursor.test.js:42 "with promises" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:55 "with limit (gh-4266)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:63 "with projection" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:190 "casting ObjectIds with where() (gh-4355)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:198 "cast errors (gh-4355)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:209 "with pre-find hooks (gh-5096)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:304 "with #next" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:276 "maps documents" (the stream part is for-await) | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:322 "iterates one-by-one, stopping for promises" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:346 "parallelization" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:372 "lean" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:401 "works (gh-4258)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:441 "data before close (gh-4998)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:515 "eachAsync() with parallel > numDocs (gh-8422)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:535 "eachAsync() with sort, parallel, and sync function (gh-8557)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:703 "passes document index as the second argument for query cursor (gh-8972)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:723 "passes document index as the second argument for aggregation cursor (gh-8972)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:744 "post hooks (gh-9435)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:895 "supports including fields using plus path that have select: false in schema (gh-13773)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:1019 "sanitizeFilter rejects $where (gh-15720)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/query.cursor.test.js:997 "applies sanitizeFilter (gh-15720)" | packages/typemo/test/ported/model/query-cursor.test.ts | pass |
| test/connection.test.js:128 "connection plugins (gh-7378)" | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:273 "should allow closing a closed connection" | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:305 "readyState is disconnected if initial connection fails (gh-6244)" | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:322 "should return an error if malformed uri passed" | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:536 "dbName option (gh-6106)" | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:547 "uses default database in uri if options.dbName is not provided" | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:559 "startSession() (gh-6653)" | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:606 "works" (useDb) | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:625 "saves correctly" (useDb) | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:830 "cache connections to the same db" | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:1088 "throws a MongooseServerSelectionError on server selection timeout (gh-8451)" | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/connection.test.js:1101 "avoids unhandled error on createConnection() if error handler registered (gh-14377)" | packages/typemo/test/ported/model/connection.test.ts | pass |
| test/model.test.js:5365 "bulkWrite casting updateMany, deleteOne, deleteMany (gh-3998)" | packages/typemo/test/ported/model/model-operations.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 |
| test/model.test.js:5404 "bulkWrite casting replaceOne (gh-3998)" | packages/typemo/test/ported/model/model-operations.test.ts | pass |
| test/model.test.js:5431 "bulkWrite should return insertedIds in the same order as the arguments (gh-16079)" | packages/typemo/test/ported/model/model-operations.test.ts | pass |
| test/model.test.js:5452 "bulkWrite error index should point to the right argument (gh-16079)" | packages/typemo/test/ported/model/model-operations.test.ts | pass |
| test/model.test.js:6767 "bulkWrite sets discriminator filters (gh-8590)" | packages/typemo/test/ported/model/model-operations.test.ts | pass |
| test/model.test.js:7080 "Model.bulkWrite(...) does not throw an error when provided an empty array (gh-9131)" | packages/typemo/test/ported/model/model-operations.test.ts | pass |
| test/model.test.js:5678 "when syncIndexes(...) is called twice with no changes on the model, the second call should not do anything" | packages/typemo/test/ported/model/model-operations.test.ts | pass |
| test/model.test.js:5698 "when called with different key order, it treats different order as different indexes (gh-8135)" | packages/typemo/test/ported/model/model-operations.test.ts | pass |
| test/model.test.js:6400 "createCollection() handles NamespaceExists errors (gh-9447)" | packages/typemo/test/ported/model/model-operations.test.ts | pass |
| test/model.test.js:2273 "countDocuments()" and :2281 "estimatedDocumentCount()" | packages/typemo/test/ported/model/model-operations.test.ts | pass |

Найдены, но не перенесены на этапе 6A (относятся к следующим слоям или legacy):

| Источник | Почему | Этап |
|---|---|---|
| test/docs/transactions.test.js:114 "save", :144 "create (gh-6909)", :315 "remove, update, updateOne (gh-7455)", :363 "save() with no changes (gh-8571)" | `save()`, `$session()` документа, `doc.updateOne/deleteOne` — слой документов | 7 |
| test/docs/transactions.test.js:445, :466, :491, :524, :583, :608, :633, :658, :725 (`$isNew`/`$isDeleted`/атомики массивов/`bulkSave`/`$createModifiedPathsSnapshot` между ретраями) | состояние документов; МЕХАНИЗМ отката (реестр участников + `onRetry`) проверен фейковым участником и failpoint в `test/runtime/connection/transactions.test.ts` | 7 |
| test/docs/transactions.test.js:243, :255, :267, :279 (populate в транзакции, gh-6754) | populate | 8 |
| test/query.cursor.test.js:124, :155 (populate в курсоре) | populate | 8 |
| test/query.cursor.test.js:228 "as readable stream", :249 "transforms document", :550–:700 (события `close`/`end`, pause/resume) | Node Readable-обёртка и события курсора — legacy Mongoose; курсор Typemo — `AsyncIterable` | n/a: legacy |
| test/query.cursor.test.js:392 "lean = false (gh-7197)", :424 "handles non-boolean lean option (gh-7137)" | у `lean()` нет аргумента | n/a: legacy |
| test/query.cursor.test.js:850, :874, :921 (`skipMiddlewareFunction`) | API хуков — этап 9 | 9 |
| test/model.insertMany.test.js:24–:188 (опция `timestamps` у insertMany), :287–:303 (`lean` обходит валидацию), :488–:720 (`rawResult`, `throwOnValidationError`), :616 (populate), :723 (depopulate) | опции Mongoose, которых нет в Typemo (строгость D8/D9: валидацию не обойти) или слой документов/populate | n/a / 7 / 8 |
| test/connection.test.js:58–:120 (`autoIndex`/`autoCreate`), :161–:250 (хелперы и события `operation-*`), :503 "bufferCommands (gh-5720)", :661–:830 (события соединений `useDb`), :891–:975 (heartbeat, буфер) | автосоздание/автоиндексы — этап 9 (коллекции); буферизации нет (решение I2, ожидание готовности); события — `onStateChange` и инструментирование | 9 / n/a |

### Этап 7B (L5: типизированные коллекции)

Источники: `test/types.array.test.js`, `test/types.documentarray.test.js`, `test/types.map.test.js`,
`test/types.subdocument.test.js`, `test/types.embeddeddocument.test.js`, `test/types.embeddeddocumentdeclarative.test.js`.
Нашлись чтением файлов (`scripts/port/find-mongoose-tests.ts` по `array`, `documentarray`, `map`, `subdocument`).
Поток Mongoose `new M() → save() → findById()` идёт через `PortedDocs` (Typemo `create` + отслеживаемые поля + запись
операций драйвером), пока нет `Document` этапа 7A. Расхождения варианта (в) — `from-mongoose-to-typemo/DIVERGENCES.md` L5B-*.

| Источник (файл:строка "название") | Наш файл | Статус |
|---|---|---|
| test/types.array.test.js:45 "behaves and quacks like an Array" | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:56 "is `deepEqual()` another array (gh-7700)" | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:151 "works with numbers" (push) | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:169 "works with strings" (push) | packages/typemo/test/ported/collections/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 (8 не кастуется в '8') |
| test/types.array.test.js:288 "works" (splice) | packages/typemo/test/ported/collections/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 ('10' не кастуется) |
| test/types.array.test.js:304 "on embedded docs" (splice) | packages/typemo/test/ported/collections/types-array.test.ts | pass (`$pop()` → `pop()`) |
| test/types.array.test.js:332 "works" (unshift) | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:429 "works" (shift) | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:520 "works" (pop) | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:582 "works" (pull) | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:603 "registers $pull atomic if pulling from middle (gh-14502)" | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:623 "handles pulling with no _id (gh-3341)" | packages/typemo/test/ported/collections/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-4 |
| test/types.array.test.js:738 "works" ($pop) | packages/typemo/test/ported/collections/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-2 |
| test/types.array.test.js:766 "works" (addToSet; значения всех видов) | packages/typemo/test/ported/collections/types-array.test.ts | pass (часть с поддокументами — в :989) |
| test/types.array.test.js:989 "handles sub-documents that do not have an _id gh-1973" | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:1138 "order should be saved" (sort) | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:1180 "works combined with other ops" (set) | packages/typemo/test/ported/collections/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-3 (`set(4)` за концом → `push`) |
| test/types.array.test.js:1222 "works with numbers" (set) | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:1504 "should adjust path positions" | packages/typemo/test/ported/collections/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-1 (`d.em1 = x` → `replace(x)`) |
| test/types.array.test.js:1593 "modifying subdoc props and manipulating the array works (gh-842)" | packages/typemo/test/ported/collections/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-11 (`deleteOne()` → `pull`) |
| test/types.array.test.js:1618 "toObject returns a vanilla JavaScript array (gh-9540)" | packages/typemo/test/ported/collections/types-array.test.ts | pass (`$toObject()`, R24) |
| test/types.array.test.js:1635 "pushing top level arrays and subarrays works (gh-1073)" | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:1656 "finding ids by string (gh-4011)" | packages/typemo/test/ported/collections/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-5 |
| test/types.array.test.js:1817, :1826, :1839, :1852, :1861 (filter, flat, flatMap, map, slice — gh-8356) | packages/typemo/test/ported/collections/types-array.test.ts | pass |
| test/types.array.test.js:1871 "does not mutate passed-in array (gh-10766)" | packages/typemo/test/ported/collections/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 (42 не кастуется в '42'; вход не мутируется) |
| test/types.array.test.js:1924 "supports setting nested arrays directly (gh-13372)" | packages/typemo/test/ported/collections/types-array.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-1 (`[0][0] = 2` → `[0].set(0, 2)`) |
| test/types.documentarray.test.js:66 "behaves and quacks like an array" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass |
| test/types.documentarray.test.js:79 "#id" | packages/typemo/test/ported/collections/types-documentarray.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-5 (id объектного типа не перенесён) |
| test/types.documentarray.test.js:191 "#id with custom schematype (gh-15725)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-5 |
| test/types.documentarray.test.js:299 "works" (create) | packages/typemo/test/ported/collections/types-documentarray.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-1 (100 не кастуется в '100') |
| test/types.documentarray.test.js:317 "does not re-cast instances of its embedded doc" | packages/typemo/test/ported/collections/types-documentarray.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-8 (хук `pre('save')` поддокумента — 7A) |
| test/types.documentarray.test.js:346 "corrects #ownerDocument() and index if value was created with array.create() (gh-1385)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-9 |
| test/types.documentarray.test.js:358 "corrects #ownerDocument() if value was created with array.create() and set() (gh-7504)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass (валидация — 7A) |
| test/types.documentarray.test.js:402 "#push should work on ArraySubdocument more than 2 levels deep" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass |
| test/types.documentarray.test.js:535 "slice() copies parent and path (gh-8317)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass |
| test/types.documentarray.test.js:551 "map() works (gh-8317)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass |
| test/types.documentarray.test.js:565 "slice() after map() works (gh-8399)", :587 "unshift() after map() works (gh-9012)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass |
| test/types.documentarray.test.js:609 "cleans modified subpaths on splice() (gh-7249)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass |
| test/types.documentarray.test.js:637 "modifies ownerDocument() on set (gh-8479)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-8 |
| test/types.documentarray.test.js:664 "modifying subdoc path after `slice()` (gh-8356)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass |
| test/types.documentarray.test.js:699 "keeps atomics after setting (gh-10272)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass (`=` → `replace`) |
| test/types.documentarray.test.js:739 "applies _id default (gh-12264)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5B-10 |
| test/types.documentarray.test.js:753 "gets correct path when underneath map (gh-12997)" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass |
| test/types.documentarray.test.js:851, :876, :901 (индексы после pull/splice/shift) | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass (`modifiedPaths` — листья; предки — 7A) |
| test/types.documentarray.test.js:926 (после `$shift()`) | — | n/a: `$shift()` нет, это `shift()` (:901) |
| test/types.documentarray.test.js:976, :1003, :1071, :1098 (unshift, positioned push, sort, reverse) | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass (positioned push → `unshift`) |
| test/types.documentarray.test.js:1041 "does not restamp existing subdocs after append-only push()" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass (штампа индекса нет вообще) |
| test/types.documentarray.test.js:1125 "registers full array atomics after reverse() follows append-only push()" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass (`$inc __v` — 7A, здесь `version: "increment"`) |
| test/types.documentarray.test.js:1179 "reindexes subdocs after addToSet() skips a duplicate" | packages/typemo/test/ported/collections/types-documentarray.test.ts | pass |
| test/types.map.test.js:34 "validation" (каст; валидаторы — 7A) | packages/typemo/test/ported/collections/types-map.test.ts | pass |
| test/types.map.test.js:134 "supports delete() (gh-7743)" | packages/typemo/test/ported/collections/types-map.test.ts | pass (`$unset` значением `""`) |
| test/types.map.test.js:273 "with single nested subdocs" | packages/typemo/test/ported/collections/types-map.test.ts | pass |
| test/types.map.test.js:506 "embedded discriminators" | packages/typemo/test/ported/collections/types-map.test.ts | pass |
| test/types.map.test.js:813 "avoids marking path as modified if setting to same value (gh-8652)" | packages/typemo/test/ported/collections/types-map.test.ts | pass |
| test/types.map.test.js:847 "handles setting map value to spread document (gh-8652)" | packages/typemo/test/ported/collections/types-map.test.ts | pass |
| test/types.map.test.js:948 "persists `.clear()` (gh-9493)" | packages/typemo/test/ported/collections/types-map.test.ts | pass |
| test/types.map.test.js:968 "supports `null` in map of subdocuments (gh-9628)" (этап 8, K10) | packages/typemo/test/ported/collections/types-map.test.ts | pass (`Spec.map(X, { nullable: true })`; без опции `null` — `CastError`, D8) |
| test/types.map.test.js:986 "tracks changes correctly (gh-9811)" | packages/typemo/test/ported/collections/types-map.test.ts | pass |
| test/types.map.test.js:1012 "handles map of arrays (gh-9813)" | packages/typemo/test/ported/collections/types-map.test.ts | pass |
| test/types.map.test.js:1155, :1178 "clears nested changes in subdocs / doc arrays (gh-15108)" | packages/typemo/test/ported/collections/types-map.test.ts | pass (`$inc __v` — 7A) |
| test/types.map.test.js:1231, :1258 (массив и Map внутри Map, gh-15350) | packages/typemo/test/ported/collections/types-map.test.ts | pass |
| test/types.subdocument.test.js:49 "returns a proper ownerDocument (gh-3589)" | packages/typemo/test/ported/collections/types-subdocument.test.ts | pass |
| test/types.subdocument.test.js:128 "saves an empty document array element as an empty object, not null (gh-7322)" | packages/typemo/test/ported/collections/types-subdocument.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L1-6 (`undefined` во входе — ошибка) |
| test/types.embeddeddocument.test.js:41 "returns a proper ownerDocument (gh-3589)" | packages/typemo/test/ported/collections/types-subdocument.test.ts | pass |

Найдены, но не перенесены на этапе 7B:

| Источник | Почему | Этап |
|---|---|---|
| test/types.array.test.js:66 (hasAtomics), :92 (indexOf), :119 (includes), :1037–:1106 (castNonArrays), :1108 (nonAtomicPush), :1715–:1810 (`remove`) | внутренности/legacy Mongoose (`$atomics`, `remove`), castNonArrays — L1-12; `indexOf`/`includes` по `==` с патчем ObjectId — не повторяем | n/a: legacy |
| test/types.array.test.js:189, :211, :242, :1306, :1333, :1383 (Buffer, Mixed в массивах) | Mixed нет (L2-1), Buffer → Binary неизменяем (D17) | n/a |
| test/types.array.test.js:262, :403, :1014, :1439, :1940, :1962 (setters массивов, gh-3032/gh-11380/gh-16372) | опция `set` у элементов массива — L2/7A | 7A |
| test/types.array.test.js:1467–:1500 (`slice` копирует схему, gh-8482/gh-8655), :1537 (пути с похожими именами), :1572 (null/undefined в массиве чисел), :1677 (Mixed по умолчанию) | внутренности схемы Mongoose / L1-5/L1-6 / Mixed | n/a |
| test/types.documentarray.test.js:208–:297 (inspect, toObject с опциями/transform), :372, :433–:533, :771 (валидация), :723 (populate), :795, :805 (reassign через `=`), :1223, :1262–:1380 (populated paths), :1381 | `toObject`-опции, валидация, `=`-присваивание корня — 7A; populate — 8 | 7A, 8 |
| test/types.documentarray.test.js:1432–:1910 | дубли блоков :1178–:1380 в том же файле | — |
| test/types.map.test.js:89, :108, :169, :207, :231, :553, :585, :602, :644, :678, :707–:946, :968, :1035–:1150, :1291–:1990 | `doc.set('m.k')`/`get`, query casting, дефолты, валидаторы, хуки, toJSON, populate, `null` в Map поддокументов (у Typemo нет nullable-значений Map — вопрос в отчёте) | 7A, 8, вопрос |
| test/types.subdocument.test.js:66, :89, :101, :113 | timestamps поддокументов, `isModified`, minimize (выключен, D25) | 7A |
| test/types.embeddeddocumentdeclarative.test.js (все 7) | схема-POJO; в Typemo схемы — только классы (L2-1) | n/a |

### Этап 7A (L5: документы, save, версионирование, toObject/toJSON)

| Источник (файл:строка "название") | Наш файл | Статус |
|---|---|---|
| test/versioning.test.js:184 "allows concurrent push" | packages/typemo/test/ported/document/versioning.test.ts | pass |
| test/versioning.test.js:207 "allows concurrent push and pull" | packages/typemo/test/ported/document/versioning.test.ts | pass |
| test/versioning.test.js:230 "throws if you set a positional path after pulling" | packages/typemo/test/ported/document/versioning.test.ts | pass (`VersionError` вместо текста "No matching document") |
| test/versioning.test.js:253 "allows pull/push after $set" | packages/typemo/test/ported/document/versioning.test.ts | pass (Mixed-массив → `string[]`) |
| test/versioning.test.js:275 "should add version to where clause" | packages/typemo/test/ported/document/versioning.test.ts | pass (`$__delta()` → команда из `CommandRecorder`) |
| test/versioning.test.js:296 "$set after pull/push throws" | packages/typemo/test/ported/document/versioning.test.ts | pass |
| test/versioning.test.js:318 "doesnt persist conflicting changes" | packages/typemo/test/ported/document/versioning.test.ts | pass |
| test/versioning.test.js:336 "increments version on push" | packages/typemo/test/ported/document/versioning.test.ts | pass |
| test/versioning.test.js:480 "should persist correctly when optimisticConcurrency is true gh-10128" | packages/typemo/test/ported/document/versioning.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5A-1 (сохранение прочитанного значения — не изменение; настоящее изменение устаревшего документа — `VersionError`) |
| test/versioning.test.js:497 "throws VersionError when saving with no changes and optimistic concurrency is true (gh-11295)" | packages/typemo/test/ported/document/versioning.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5A-1 |
| test/versioning.test.js:561 "pull doesnt add version where clause (gh-6190)" | packages/typemo/test/ported/document/versioning.test.ts | pass |
| test/versioning.test.js:601 "optimistic concurrency (gh-9001) (gh-5424)" | packages/typemo/test/ported/document/versioning.test.ts | pass |
| test/versioning.test.js:622 "adds version to filter if pushing to a nested array (gh-11108)" | packages/typemo/test/ported/document/versioning.test.ts | pass |
| test/docs/transactions.test.js:445 "transaction() resets $isNew on error" | packages/typemo/test/ported/document/transactions.test.ts | pass |
| test/docs/transactions.test.js:466 "transaction() resets $isNew between retries (gh-13698)" | packages/typemo/test/ported/document/transactions.test.ts | pass |
| test/docs/transactions.test.js:490 "transaction() resets $isDeleted between retries" | packages/typemo/test/ported/document/transactions.test.ts | pass (публичного `$isDeleted` нет: повторный `$deleteOne` не отказал бы, если бы флаг не откатился) |
| test/docs/transactions.test.js:523 "handles resetting array state with $set atomic (gh-13698)" | packages/typemo/test/ported/document/transactions.test.ts | pass |
| test/docs/transactions.test.js:582 "transaction() resets $isNew between retries with bulkSave() (gh-16432)" | packages/typemo/test/ported/document/transactions.test.ts | pass |
| test/docs/transactions.test.js:605 "transaction() restores modified paths between retries with bulkSave() (gh-16432)" | packages/typemo/test/ported/document/transactions.test.ts | pass |
| test/document.test.js:566 "propagates toObject transform function to all subdocuments (gh-14589)" | packages/typemo/test/ported/document/document.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5A-2 |
| test/document.test.js:1254 "toObject should not set undefined values to null" | packages/typemo/test/ported/document/document.test.ts | pass (массивы без `required` и `default` начинаются с `[]`, как в Mongoose — R56) |
| test/document.test.js:5057 "nested docs toObject() clones (gh-5008)" | packages/typemo/test/ported/document/document.test.ts | pass |
| test/document.test.js:7436 "converts UUIDs to strings in toJSON()" | packages/typemo/test/ported/document/document.test.ts | pass (всегда, без опции `flattenUUIDs`) |
| test/document.test.js:10886 "is available as `$isModified`" | packages/typemo/test/ported/document/document.test.ts | pass |
| test/document.test.js:10912 "is available as `$isNew`" | packages/typemo/test/ported/document/document.test.ts | pass (`$isNew()` — метод) |
| test/document.test.js:13430 "should not trigger isModified when setting a nested boolean to the same value as previously (gh-12992)" | packages/typemo/test/ported/document/document.test.ts | pass (`$set("result", {...})` вместо присваивания) |
| test/document.modified.test.js:90 "reset after save" | packages/typemo/test/ported/document/document.test.ts | pass |
| test/document.modified.test.js:104 "of embedded docs reset after save" | packages/typemo/test/ported/document/document.test.ts | pass |
| test/document.modified.test.js:136 "when modifying keys" | packages/typemo/test/ported/document/document.test.ts | pass |
| test/document.modified.test.js:155 "setting a key identically to its current value should not dirty the key" | packages/typemo/test/ported/document/document.test.ts | pass |
| test/timestamps.test.js:478 "should not override createdAt when not selected (gh-4340)" | packages/typemo/test/ported/document/document.test.ts | pass |
| test/timestamps.test.js:529 "should have fields when create" | packages/typemo/test/ported/document/document.test.ts | pass |
| test/timestamps.test.js:551 "sets timestamps on replaceOne (gh-9951)" | packages/typemo/test/ported/document/document.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5A-3 (J5) |
| test/timestamps.test.js:564 "should change updatedAt when save" | packages/typemo/test/ported/document/document.test.ts | pass |
| test/timestamps.test.js:574 "should not change updatedAt when save with no modifications" | packages/typemo/test/ported/document/document.test.ts | pass |

Найдены, но не перенесены (7A):

| Источник | Причина | Статус |
|---|---|---|
| test/versioning.test.js:70, :130, :141, :95, :113, :647 (gh-10980) | `versionKey` настраивается/отключается/во вложенном пути, strict-опция — в Typemo версия только через `Versioned` (D13) | n/a: другая модель (D13) |
| test/versioning.test.js:158, :381, :400, :423, :450, :465 | Mixed-массивы, `skipVersioning` — нет в Typemo (D8: нет Mixed) | n/a |
| test/versioning.test.js:515 "optimisticConcurrency being an array of strings", :740–:790 (`{ exclude }`) | подмножество путей для OCC — нет (вопрос отчёта 07a) | вопрос |
| test/versioning.test.js:549 (gh-2675) | опция `versionKey: false` у `toObject` — нет | n/a (опции не заведены) |
| test/document.test.js:378, :537, :594, :685, :714, :875, :908, :1096 | схемные `toObject`/`toJSON`-опции, алиасы — нет схемных опций сериализации | n/a: R18 (опции сериализации только при вызове; from-mongoose-to-typemo/DIVERGENCES.md L5A-16) |
| test/document.modified.test.js:168, :185–:269, :316–:482, :542 | строка ключей через пробел, `unmarkModified`, populate-пути, Mixed | n/a / этап 8 |
| test/timestamps.test.js:27–:123, :139–:367 | `timestamps`-опции схемы (имена, `createdAt: false`, nested) — служебные поля через `Timestamped` (D13) | n/a (D13) |

## Этап 8 — populate (L6), порция 1

Поиск: `bun run scripts/port/find-mongoose-tests.ts populate` (227 кандидатов; `test/model.populate.test.js` — 336 тестов,
12 850 строк). Перенесено порционно, по вариантам таблицы research M8: каждый вариант (одиночная ссылка, массив,
`retainNullValues`, sort/limit/skip, `justOne`, виртуалы, `count`, `match` (объект и функция), `perDocumentLimit`,
`refPath`, Map, вложенный populate, lean, дискриминаторы, `transform`, UUID/String/Number `_id`, методы документа)
покрыт хотя бы одним тестом Mongoose. Позиционная сигнатура `populate(path, select, match, options)` и пути через
пробел — legacy (M8), в перенесённых тестах записаны объектной формой.

| Источник (файл:строка "название") | Наш файл | Статус |
|---|---|---|
| test/model.populate.test.js:256 "populating a single ref" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:277 "not failing on null as ref" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:364 "populating with partial fields selection" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (`isInit` → «ключ не загружен») |
| test/model.populate.test.js:388 "population of single oid with partial field selection and filter" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:419 "population of undefined fields in a collection of docs" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:571 "populating an array of refs and fetching many" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (`sort({ _id: 1 })` вместо естественного порядка) |
| test/model.populate.test.js:652 "populating an array of references with fields selection" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:691 "populating an array of references and filtering" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:1159 "properly handles limit per document (gh-2151)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (`Model.populate(docs)` → путь `author.friends` в запросе; опции не мутируются) |
| test/model.populate.test.js:1296 "supports `retainNullValues` to override filtering out null docs (gh-6432)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (`undefined` в массиве не хранится, D8: вместо него висячий id) |
| test/model.populate.test.js:1468 "passing sort options to the populate method" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:1511 "limit should apply to each returned doc, not in aggregate (gh-1490)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:1555 "populate should work on String _ids" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:1639 "populate should work on Number _ids" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (нашёл баг L2: `Ref<M, number>` требовал `enum` — исправлен) |
| test/model.populate.test.js:2084 "populating combined with lean (gh-1260) with find" (+ :2058 with findOne) | packages/typemo/test/ported/populate/model-populate.test.ts | pass (find и findOne дают одну форму, задача 8.5) |
| test/model.populate.test.js:2157 "records paths and _ids used in population with findOne" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (`$populated`) |
| test/model.populate.test.js:2363 "DynRef Simple populate" | packages/typemo/test/ported/populate/model-populate.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L6-4 (`refPath` относительно владельца) |
| test/model.populate.test.js:2371 "DynRef Array populate" | packages/typemo/test/ported/populate/model-populate.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L6-4 |
| test/model.populate.test.js:2768 "readable error with deselected refPath (gh-6834)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (`QueryError`) |
| test/model.populate.test.js:2957 "maps results back to correct document (gh-1444)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:2987 "handles skip" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:3124 "discriminator child schemas (gh-3878)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (через базовую модель путь дискриминатора — ошибка типов; рантайм — по схеме документа) |
| test/model.populate.test.js:3176 "deep populate single -> array (gh-3904)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:3288 "4 level population (gh-3973)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:3605 "basic populate virtuals" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:3634 "match (gh-6787)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (`match` виртуала — опция `@Virtual`) |
| test/model.populate.test.js:3661 "match prevents using $where" | packages/typemo/test/ported/populate/model-populate.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L6-5 (отказ до запроса `StrictModeError`; экземпляр класса как фильтр — отказ) |
| test/model.populate.test.js:3720 "multiple source docs" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:3783 "source array" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:4012 "justOne option (gh-4263)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:4048 "justOne + lean (gh-6234)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (явный `sort` вместо естественного порядка) |
| test/model.populate.test.js:4087 "sets empty array if lean with justOne = false and no results (gh-10992)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:4152 "with no results and justOne (gh-4284)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (нашёл баг: литералы `$lookup` для массива-foreignField приводились как массив — исправлен) |
| test/model.populate.test.js:4451 "with functions for match (gh-7397)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (запрос на документ, D36; нашёл баг смешения результатов между документами — исправлен) |
| test/model.populate.test.js:7478 "count option (gh-4469) (gh-7380)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:8620 "supports top-level match option (gh-8475)" | packages/typemo/test/ported/populate/model-populate.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L6-2 (D35: `$and`, а не замена) |
| test/model.populate.test.js:8652 "supports top-level skip and limit options (gh-8445)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (опции в `options`; пары `skip`+`options.skip` нет) |
| test/model.populate.test.js:8711 "top-level limit properly applies limit per document (gh-8657)" | packages/typemo/test/ported/populate/model-populate.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L6-1 (лимит на документ точно; у Mongoose второй документ пуст) |
| test/model.populate.test.js:8732 "correct limit with populate (gh-7318)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:8785 "perDocumentLimit as option to `populate()` method (gh-7318) (gh-9418)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:9118 "throws an error when using limit with perDocumentLimit" | packages/typemo/test/ported/populate/model-populate.test.ts | pass (`QueryError`) |
| test/model.populate.test.js:9752 "supports `transform` option (gh-3375)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:9872 "transform to primitive (gh-10064)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:9902 "transform with virtual populate, justOne = true (gh-3375)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:9939 "transform with virtual populate, justOne = false (gh-3375)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:10566 "handles refPath underneath map of subdocuments (gh-9359)" | packages/typemo/test/ported/populate/model-populate.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L6-4 |
| test/model.populate.test.js:10730 "merges match when match is on `_id` (gh-12834)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/model.populate.test.js:11633 "handles populating uuids (gh-14869)" | packages/typemo/test/ported/populate/model-populate.test.ts | pass |
| test/document.populate.test.js:162 "works with await" | packages/typemo/test/ported/populate/document-populate.test.ts | pass |
| test/document.populate.test.js:198 "using multiple populate calls" | packages/typemo/test/ported/populate/document-populate.test.ts | pass |
| test/document.populate.test.js:306 "a property not in schema" | packages/typemo/test/ported/populate/document-populate.test.ts | pass (`QueryError`; тип — ошибка) |
| test/document.populate.test.js:313 "of empty array" | packages/typemo/test/ported/populate/document-populate.test.ts | pass |
| test/document.populate.test.js:326 "of null property" | packages/typemo/test/ported/populate/document-populate.test.ts | pass |
| test/document.populate.test.js:544 "can depopulate specific path (gh-2509)" | packages/typemo/test/ported/populate/document-populate.test.ts | pass |
| test/document.populate.test.js:606 "depopulates all (gh-6073)" | packages/typemo/test/ported/populate/document-populate.test.ts | pass |
| test/document.populate.test.js:636 "doesn't throw when called on a doc that is not populated (gh-6075)" | packages/typemo/test/ported/populate/document-populate.test.ts | pass |
| test/document.populate.test.js:739 "depopulates after pushing manually populated (gh-2509)" | packages/typemo/test/ported/populate/document-populate.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L6-3 (представление только для чтения) |

Найдены, но не перенесены в порции 1 (следующие порции — по запросу):

| Источник | Причина | Статус |
|---|---|---|
| test/model.populate.test.js: остальные ~285 тестов (строки 88–12 850) | порционный перенос: варианты уже покрыты тестами порции 1 и собственными тестами этапа 8 | следующая порция |
| test/model.populate.test.js:1823–1860, :6069, :7606 (опция `model`), :7911, :11391 (`ref` функцией/моделью) | `ref` — только `() => M`; динамика — `refModel`/`refPath` (D11) | n/a: другая модель (D11) |
| test/model.populate.test.js:4314, :4538, :12258–:12802 (`refPath`/`foreignField` функцией) | `refPath` — строка (путь владельца); функция — `refModel` | n/a (D11) |
| test/model.populate.test.js:6742–:6802 (lean на уровне populate) | `lean` задаётся запросом целиком | n/a |
| test/model.populate.test.js:7632, :9175, :9201 (`clone`) | перенесены на этапе 9A (решение L5): packages/typemo/test/ported/populate/populate-clone.test.ts | pass |
| test/model.populate.test.js:11670, :11705 (`forceRepopulate`) | повторный populate всегда заменяет (задача 8.4) | n/a |
| test/model.populate.test.js:10859–:10985 (`strictPopulate`) | неизвестный путь — всегда ошибка (D8) | n/a (D8) |
| test/model.populate.test.js:2935, :6166, :6238 (пути через пробел) | legacy-сигнатура | n/a: legacy |
| test/model.populate.divergent.test.js (3), test/model.populate.setting.test.js (2) | ручной populate присваиванием документа и `$set`/`$pop` populated-массива — в Typemo представление только для чтения | n/a (L6-3) |

### Этап 9B (L7: коллекции, индексы, views, change streams)

Файл: `test/ported/mechanisms/storage.test.ts`. Отложенные строки этапа 4 (`model.indexes.test.js:257, :278, :334–401, :497–718`) и этапа 6 (`connection.test.js:58–:120` про autoCreate/autoIndex) разобраны здесь.

| Источник (файл:строка "название") | Наш файл | Статус |
|---|---|---|
| test/model.indexes.test.js:257 "error should emit on the model" | test/ported/mechanisms/storage.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L7B-3 (`IndexSyncError` со всеми сбоями вместо события `index` модели) |
| test/model.indexes.test.js:278 "when one index creation errors" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.indexes.test.js:316 "creates descending indexes from schema definition(gh-8895)" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.indexes.test.js:334 "can be disabled" | test/ported/mechanisms/storage.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L7B-4 (нет авто-индексов при создании модели; `autoIndex: false` исключает из `syncAll`) |
| test/model.indexes.test.js:357 "will create indexes as a default" | — | n/a: Typemo не строит индексы неявно при создании модели (L7B-4); явный `syncIndexes`/`syncAll` покрыт тестами :401 и `syncAll` |
| test/model.indexes.test.js:368 "will not create indexes if the global auto index is false and schema option isnt set (gh-1875)" | — | n/a: глобального `autoIndex` нет (L7B-4) |
| test/model.indexes.test.js:388 "is a function", :394 "returns a Promise" | — | n/a: legacy (`ensureIndexes` — синоним `createIndexes`, проверки «это функция/промис» не несут логики) |
| test/model.indexes.test.js:401 "creates indexes" | test/ported/mechanisms/storage.test.ts | pass (через `createIndexes`: событие `index` — legacy EventEmitter) |
| test/model.indexes.test.js:497 "decorated discriminator index with syncIndexes (gh-6347)" | test/ported/mechanisms/storage.test.ts | pass (нашёл баг: индексы дискриминатора синхронизировались без scope корня — исправлено, индексы у коллекции) |
| test/model.indexes.test.js:514 "uses schema-level collation by default (gh-9912)" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.indexes.test.js:537 "different collation with syncIndexes() (gh-8521)" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.indexes.test.js:572 "reports syncIndexes() error (gh-9303)" | test/ported/mechanisms/storage.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L7B-3 (код 11000 — у `failures[i].error`) |
| test/model.indexes.test.js:600 "should not re-create a compound text index that involves non-text indexes, using syncIndexes (gh-13136)" | test/ported/mechanisms/storage.test.ts | pass (нашёл баг сравнения составного text-индекса — исправлено) |
| test/model.indexes.test.js:632 "should not find a diff when calling diffIndexes after syncIndexes involving a text and non-text compound index (gh-13136)" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.indexes.test.js:664 "cleanIndexes (gh-6676)" | test/ported/mechanisms/storage.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L7B-5 (`cleanIndexes` нет: `syncIndexes` удаляет необъявленные) |
| test/model.indexes.test.js:688 "should prevent collation on text indexes (gh-10044)" | test/ported/mechanisms/storage.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L7B-2 (ошибка сборки вместо тихого снятия collation) |
| test/model.indexes.test.js:705 "should do a dryRun feat-10316" | test/ported/mechanisms/storage.test.ts | pass (`toCreate` — имена индексов, как во всём `IndexDiff`) |
| test/model.indexes.test.js:718 "running diffIndexes with a non-existent collection should not throw an error (gh-14010)" | test/ported/mechanisms/storage.test.ts | pass |
| test/collection.capped.test.js:30 "schemas should have option size" | test/ported/mechanisms/storage.test.ts | pass |
| test/collection.capped.test.js:38 "creation" | test/ported/mechanisms/storage.test.ts | pass |
| test/collection.capped.test.js:56 "skips when setting autoCreate to false (gh-8566)" | test/ported/mechanisms/storage.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L7B-4 (`autoCreate: false` — вне `syncAll`; опции коллекции — только из схемы, L7B-8) |
| test/model.test.js:6200 "createCollection() respects schema collation (gh-6489)" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.test.js:6220 "createCollection() respects timeseries (gh-10611)" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.test.js:6258 "createCollection() enforces expireAfterSeconds (gh-11229)", :6285 "createCollection() enforces expires (gh-11229)" | — | n/a: `createCollection` не принимает опций (L7B-8); строки-длительности `expires` — legacy-формат |
| test/model.test.js:6313 "createCollection() enforces expireAfterSeconds when set by Schema (gh-11229)" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.test.js:6341 "createCollection() enforces expires when set by Schema (gh-11229)" | — | n/a: `expires` строкой не поддерживается (только `expireAfterSeconds` числом, L7B-8) |
| test/model.test.js:6369 "createCollection() respects clusteredIndex" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.test.js:6400 "createCollection() handles NamespaceExists errors (gh-9447)" (вторая половина: существующая коллекция с ДРУГИМИ опциями) | test/ported/mechanisms/storage.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L7B-1 |
| test/model.test.js:9145 "respects schema-level `collectionOptions` for setting options to createCollection()" | — | n/a: опции `collectionOptions` нет — каждая опция коллекции объявлена в `@Schema` явно (L7B-8) |
| test/connection.test.js:58 "with autoIndex (gh-5423)" | — | n/a: опции соединения `autoIndex` нет (L7B-4) |
| test/connection.test.js:67 "with autoCreate (gh-6489)" | test/ported/mechanisms/storage.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L7B-4 (создание — `syncAll`, не `init()`) |
| test/connection.test.js:92 "with autoCreate = false (gh-8814)" | test/ported/mechanisms/storage.test.ts | pass |
| test/connection.test.js:108 "autoCreate when collection already exists does not fail (gh-7122)" | test/ported/mechanisms/storage.test.ts | pass |
| test/connection.test.js:172 "createCollection()" | — | n/a: `connection.createCollection(name, options)` без модели — вне L7 (опции коллекции — у схемы) |
| test/connection.test.js:1792 "should create collections for all models on the connection with the createCollections() function (gh-13300)" | test/ported/mechanisms/storage.test.ts | pass (через `syncAll`) |
| test/model.test.js:4084 "watch() (gh-5964)" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.test.js:4101 "bubbles up resumeTokenChanged events (gh-13607)", :4305 "(gh-14349)" | — | n/a: события EventEmitter не переносятся (L7B-6); `resumeToken` — свойство потока (test/runtime/mechanisms/change-streams.test.ts) |
| test/model.test.js:4115 "using next() and hasNext() (gh-11527)" | — | n/a: `hasNext` — есть `tryNext`/`next` (L7B-6), покрыто runtime-тестами |
| test/model.test.js:4129 "using next() and hasNext() before connecting (gh-16034)", :4232 "watch() before connecting (gh-5964)" | test/ported/mechanisms/storage.test.ts | pass: логика «watch до connect» — один тест (`watch()` ждёт готовности, I2); `hasNext` — n/a (L7B-6) |
| test/model.test.js:4150 "fullDocument (gh-11936)" | test/ported/mechanisms/storage.test.ts | pass: логика совпадает с gh-14049 (updateLookup + hydrate), один тест |
| test/model.test.js:4180 "fullDocument with immediate watcher and hydrate (gh-14049)" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.test.js:4213 "respects discriminators (gh-11007)" | test/ported/mechanisms/storage.test.ts | pass |
| test/model.test.js:4257 / model.watch.test.js:43 "watch() close() prevents buffered watch op from running (gh-7022)" | — | n/a: буфера команд нет (I2): `watch()` возвращает промис потока, закрыть «ещё не открытый» поток нечего |
| test/model.test.js:4281 / model.watch.test.js:64 "watch() close() closes the stream (gh-7022)" | test/ported/mechanisms/storage.test.ts | pass (событие `close` → `closed`) |
| test/model.watch.test.js:25 "watch() before connecting (gh-5964)" | test/ported/mechanisms/storage.test.ts | pass |

### Этап 9A (L7: хуки, плагины, политики)

| Источник | Тест Typemo | Статус |
|---|---|---|
| test/query.middleware.test.js:59 "has a pre find hook" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:70 "has post find hooks" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:87 "works when using a chained query builder" | — | n/a: `findOne().find()` (смена операции в цепочке) — в Typemo операция задаётся точкой входа |
| test/query.middleware.test.js:109 "has separate pre-findOne() and post-findOne() hooks" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:129 "with regular expression (gh-6680)" | — | n/a: события — явный список со scope (D27, DIVERGENCES L7A-1) |
| test/query.middleware.test.js:161 "can populate in pre hook" | — | divergence: DIVERGENCES L7A-6 (pre-хук не меняет операцию) |
| test/query.middleware.test.js:174 "can populate in post hook" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:185 "has hooks for countDocuments()" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:208 "has hooks for estimatedDocumentCount()" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:231 "updateOne() (gh-3997)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass (`{}` → `Filters.all()`, D8) |
| test/query.middleware.test.js:256 "updateMany() (gh-3997)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass (`{}` → `Filters.all()`, D8) |
| test/query.middleware.test.js:282 "deleteOne() (gh-7195)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:308 "deleteMany() (gh-7195)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:333 "distinct (gh-5938)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:357 "error handlers (gh-2284)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:380 "error handlers for validate (gh-4885)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:395, :415 (passRawResult, gh-4836) | — | n/a: legacy-опция `passRawResult`; ошибка `findOneAndUpdate` → postError покрыта hooks.test.ts |
| test/query.middleware.test.js:436 "error handlers with error from pre hook (gh-4927)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:461 "with clone() (gh-5153)" | — | n/a: `schema.clone()` нет |
| test/query.middleware.test.js:482 "doesnt double call post(regexp) with updateOne (gh-7418)" | — | n/a: regexp-событий нет; одиночный post — hooks.test.ts |
| test/query.middleware.test.js:497 "deleteOne with `document: true` but no `query` (gh-8555)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/query.middleware.test.js:517 "allows registering middleware for all queries with regexp (gh-9190)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass (список событий вместо regexp) |
| test/query.middleware.test.js:545 "allows skipping the wrapped function with `skipMiddlewareFunction()` (gh-11426)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass (`this.skip`, DIVERGENCES L7A-5) |
| test/query.middleware.test.js:565 "allows overwriting result with `overwriteMiddlewareResult()` (gh-11426)" | — | divergence: DIVERGENCES L7A-5 (подмены результата в post нет) |
| test/model.middleware.test.js:29 "post save" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/model.middleware.test.js:67, :286 (sync error in post/pre save, gh-3483) | packages/typemo/test/runtime/mechanisms/hooks.test.ts | pass (своими тестами: брошенный post-хук, H510) |
| test/model.middleware.test.js:86, :109 (hook promises, gh-3779) | — | pass по построению: хуки всегда await (async в fixtures) |
| test/model.middleware.test.js:132 "validate middleware runs before save middleware (gh-2462)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | divergence: DIVERGENCES L5A-4 (D25: save → validate) |
| test/model.middleware.test.js:152 "works" | — | n/a: `doc.init(raw)` — legacy-API; init — hooks.test.ts |
| test/model.middleware.test.js:193 "post init hooks" | packages/typemo/test/runtime/mechanisms/hooks.test.ts | divergence: DIVERGENCES L7A-9 |
| test/model.middleware.test.js:233 "gh-1829" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/model.middleware.test.js:309 "validate + remove" | — | n/a: опции `deleteOne(opts)` в хуке; `document.deleteOne` — hooks.test.ts |
| test/model.middleware.test.js:356, :388 (static hooks, gh-5982) | — | n/a: хуков статиков нет (статики плагинов — обычные функции) |
| test/model.middleware.test.js:418 "deleteOne hooks (gh-7538)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | divergence: DIVERGENCES L7A-1 (D27) |
| test/model.middleware.test.js:460 (createCollection middleware) | — | n/a: события `createCollection` нет (коллекции — 9B, явный вызов) |
| test/model.middleware.test.js:496 "calls bulkWrite hooks" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/model.middleware.test.js:526 "allows updating ops" | — | divergence: DIVERGENCES L7A-6 |
| test/model.middleware.test.js:545 "supports error handlers" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/model.middleware.test.js:571 "post save error handler gets doc as param (gh-15480)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass (`this` — документ) |
| test/model.middleware.test.js:611 "supports skipping wrapped function" | packages/typemo/test/runtime/mechanisms/hooks.test.ts | pass (skip) |
| test/model.middleware.test.js:630–:663 (pre-hook errors propagate, gh-15881) | packages/typemo/test/regressions/mechanisms/hooks-history.test.ts | pass (H077) |
| test/model.middleware.preposttypes.test.js:77 | — | n/a: `this` задан типом события (typed this — types/mechanisms) |
| test/model.skip.middleware.test.js (все, gh-8768) | — | n/a: опции `middleware: false` нет — вопрос отчёта 09a |
| test/aggregate.test.js:903 "pre" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/aggregate.test.js:920, :938 (option / append in pre) | — | divergence: DIVERGENCES L7A-6 |
| test/aggregate.test.js:959 "post" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/aggregate.test.js:976, :997 (error handlers) | packages/typemo/test/runtime/mechanisms/hooks.test.ts | pass (postError на ошибке драйвера и pre-хука) |
| test/aggregate.test.js:1021 "with agg cursor" | packages/typemo/test/ported/mechanisms/middleware.test.ts | divergence: DIVERGENCES L7A-3 |
| test/aggregate.test.js:1048 "with explain() (gh-5887)" | packages/typemo/test/ported/mechanisms/middleware.test.ts | pass |
| test/aggregate.test.js:1338 "cursor() errors out if schema pre aggregate hook throws (gh-15279)" | packages/typemo/test/regressions/mechanisms/hooks-history.test.ts | pass (H131) |
| test/connection.test.js:128 "connection plugins (gh-7378)" | packages/typemo/test/ported/mechanisms/plugins.test.ts | pass |
| test/index.test.js:340 "declaring global plugins (gh-5690)" | packages/typemo/test/ported/mechanisms/plugins.test.ts | pass (свой процесс; `methods` — методы класса, D23) |
| test/index.test.js:383, :418, :442, :479, :498 (теги, discriminators, childSchemas, recompile) | — | n/a: DIVERGENCES L7A-7 |
| test/model.populate.test.js:7632, :9175, :9201 (clone) | packages/typemo/test/ported/populate/populate-clone.test.ts | pass |
| document.hooks.test.js | — | n/a: в Mongoose 9.10.2 такого файла нет (хуки документа — model.middleware.test.js) |
| test/query.test.js:3471 "sanitizeProjection option with plus paths (gh-14333) (gh-10243)" | packages/typemo/test/ported/query/sanitize-projection.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L4B-9 |
| test/query.test.js:3457 "sanitizeProjection option (gh-10243)" | packages/typemo/test/ported/query/sanitize-projection.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L4B-9 |
| test/versioning.test.js:515 "should support optimisticConcurrency being an array of strings" | packages/typemo/test/ported/document/concurrency-fields.test.ts | pass (равное прочитанному — не изменение, L5A-1; настоящее изменение устаревшего — `VersionError`) |
| test/versioning.test.js:768 "sets VERSION_ALL when modifying specified field" | packages/typemo/test/ported/document/concurrency-fields.test.ts | pass (`$__.version` → фильтр и `$inc` отправленной команды) |
| test/versioning.test.js:780 "sets VERSION_ALL when modifying specified array field" | packages/typemo/test/ported/document/concurrency-fields.test.ts | pass |
| test/versioning.test.js:792 "does not set version when modifying non-specified field" | packages/typemo/test/ported/document/concurrency-fields.test.ts | pass |
| test/versioning.test.js:804 "does not set version when modifying non-specified array field" | packages/typemo/test/ported/document/concurrency-fields.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5A-14 |
| test/versioning.test.js:815 "sets VERSION_ALL when modifying a map key matching a wildcard path (gh-16383)" | packages/typemo/test/ported/document/concurrency-fields.test.ts | pass |
| test/versioning.test.js:832 "sets VERSION_ALL when modifying array element path matching a subdocument path (gh-16383)" | packages/typemo/test/ported/document/concurrency-fields.test.ts | pass |
| test/versioning.test.js:849 "does not set version when modifying non-specified subdocument path (gh-16383)" | packages/typemo/test/ported/document/concurrency-fields.test.ts | divergence: from-mongoose-to-typemo/DIVERGENCES.md L5A-14 |
| test/versioning.test.js:866 "does not set version when modifying non-specified field with wildcard path (gh-16383)" | packages/typemo/test/ported/document/concurrency-fields.test.ts | pass |
| test/model.test.js:3117 "should include __v when optimisticConcurrency array contains a parent path and subdocument is modified (gh-16054)" | packages/typemo/test/ported/document/concurrency-fields.test.ts | pass (`user.profile = {…}` → `$set("profile", …)`) |
| test/versioning.test.js:883–975, test/model.test.js:3083, :3099, :3135, :3153 (`optimisticConcurrency: { exclude }`) | — | n/a: DIVERGENCES L5A-15 (формы `exclude` нет) |
