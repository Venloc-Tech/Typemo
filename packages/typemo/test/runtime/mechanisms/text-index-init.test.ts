/*
 * A text index is stored by the server with what it adds itself (weight 1 for every text field without
 * an explicit weight, `default_language`, `language_override`, `textIndexVersion`, `_fts`/`_ftsx` keys):
 * a second `connection.init()` compares it as in sync — with and without `weights`, compound, and the
 * field option `text: true`.
 */
import { describe, expect, test } from "bun:test";
import { Entity, Index, Prop, Schema } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** Two text fields, one with an explicit weight. */
@Index({ title: "text", body: "text" }, { weights: { title: 5 }, name: "search" })
@Schema({ collection: "ti_weighted" })
class Weighted extends Entity {
  @Prop(() => String) title?: string;
  @Prop(() => String) body?: string;
}

/** Two text fields without weights. */
@Index({ title: "text", body: "text" })
@Schema({ collection: "ti_plain" })
class Plain extends Entity {
  @Prop(() => String) title?: string;
  @Prop(() => String) body?: string;
}

/** A compound text index: a prefix key, a text field with a weight, another text field. */
@Index({ tenant: 1, title: "text", body: "text" }, { weights: { body: 3 }, default_language: "russian" })
@Schema({ collection: "ti_compound" })
class Compound extends Entity {
  @Prop(() => String) tenant?: string;
  @Prop(() => String) title?: string;
  @Prop(() => String) body?: string;
}

/** Text fields declared with the field option. */
@Schema({ collection: "ti_field" })
class FieldText extends Entity {
  @Prop(() => String, { text: true }) title?: string;
  @Prop(() => String, { text: true }) body?: string;
}

const t = ModelLifecycle.useTypemo("text_index_init");

describe("text index: a second init() is in sync", () => {
  for (const entity of [Weighted, Plain, Compound, FieldText]) {
    test(entity.name, async () => {
      t.connection.model(entity);
      const first = await t.connection.init();
      expect(first.failed).toBe(false);
      const again = await t.connection.init();
      expect(again.failed).toBe(false);
      const entry = again.collections.find((item) => item.collection.startsWith("ti_"));
      expect(entry?.indexes?.toCreate).toEqual([]);
      expect(entry?.indexes?.toDrop ?? []).toEqual([]);
    });
  }
});
