import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ValueFormsTable } from "../../../../scripts/value-forms-table.ts";
import { BsonTypeTable } from "../../src/index.ts";

/*
 * The per-type table of from-mongoose-to-typemo/guides/value-forms.md is generated from `BsonTypeTable`
 * (`bun run forms:table`). A row added or a form changed in the table without regenerating the guide fails here.
 */

/*
 * The guide is local working material (not in the repository): the guard is defined only where the guide is present,
 * like the other tests of local pages (no skipped test waiting for nothing).
 */
const GUIDE = resolve(import.meta.dir, "../../../../from-mongoose-to-typemo/guides/value-forms.md");

if (existsSync(GUIDE))
  describe("guards: from-mongoose-to-typemo/guides/value-forms.md follows BsonTypeTable", () => {
    test("the generated table of the guide is current (run `bun run forms:table`)", () => {
      const current = ValueFormsTable.current();
      expect(ValueFormsTable.apply(current)).toBe(current);
    });

    test("every row of the table is in the guide, with its four forms", () => {
      const current = ValueFormsTable.current();
      for (const row of ValueFormsTable.rows()) {
        expect(current).toContain(`\`${row.forms.plain.replaceAll("|", "\\|")}\``);
      }
      expect(ValueFormsTable.rows().length).toBe(BsonTypeTable.keys.length);
    });

    test("a guide without the markers is an error, not a silent no-op", () => {
      expect(() => ValueFormsTable.apply("# no table here")).toThrow(/markers/);
    });
  });
