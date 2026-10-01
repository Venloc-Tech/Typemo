/*
 * Ported from mongoose test/types.subdocument.test.js and test/types.embeddeddocument.test.js:
 * the owner document of nested subdocuments, and empty array elements.
 */
import { describe, expect, test } from "bun:test";
import { Entity, Prop, Schema } from "../../../src/index.ts";
import { PortedDocs } from "../../fixtures/collections/ported-docs.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("p_types_subdoc");

@Schema()
class GrandChild extends Entity {
  @Prop(() => String) name?: string;
}

@Schema()
class Child extends Entity {
  @Prop(() => String) name?: string;
  @Prop(() => GrandChild) child?: GrandChild;
  @Prop(() => [GrandChild]) children?: GrandChild[];
}

@Schema({ collection: "ps_parents" })
class Parent extends Entity {
  @Prop(() => String) name?: string;
  @Prop(() => [Child]) children?: Child[];
  @Prop(() => Child) child?: Child;
}

@Schema()
class Item {
  @Prop(() => Number) taxRate?: number;
  @Prop(() => Number) taxAmount?: number;
}

@Schema({ collection: "ps_items" })
class Items extends Entity {
  @Prop(() => [Item]) items?: Item[];
}

describe("types.subdocument", () => {
  // ported from mongoose test/types.subdocument.test.js:49 "returns a proper ownerDocument (gh-3589)"
  test("returns a proper ownerDocument (gh-3589)", async () => {
    const p = await PortedDocs.create(t, Parent, {
      name: "Parent Parentson",
      children: [{ name: "Child Parentson", child: { name: "GrandChild Parentson" } }],
    });
    expect(p.doc.children?.[0]?.child?.$ownerDocument()).toBe(p.fields);
    expect(p.doc.children?.[0]?.child?.$fullPath()).toBe("children.0.child");
  });

  // ported from mongoose test/types.subdocument.test.js:128 "saves an empty document array element as an empty object, not null (gh-7322)"
  // divergence (strict): `undefined` is never a value, so the empty element is written `{}` as input.
  test("saves an empty document array element as an empty object, not null (gh-7322)", async () => {
    const doc = await PortedDocs.create(t, Items, { items: [{ taxRate: 19 }] });
    doc.doc.items?.push({});
    await doc.save(t.mongo.db.collection("ps_items"));
    const raw = await t.mongo.db.collection("ps_items").findOne({ _id: doc.id as never });
    expect(raw?.items).toEqual([{ taxRate: 19 }, {}]);
  });
});

describe("types.embeddeddocument", () => {
  // ported from mongoose test/types.embeddeddocument.test.js:41 "returns a proper ownerDocument (gh-3589)"
  test("returns a proper ownerDocument (gh-3589)", async () => {
    const p = await PortedDocs.create(t, Parent, {
      name: "Parent Parentson",
      child: { name: "Child Parentson", children: [{ name: "GrandChild Parentson" }] },
    });
    expect(p.doc.child?.children?.[0]?.$ownerDocument()).toBe(p.fields);
    expect(p.doc.child?.children?.[0]?.$parent()).toBe(p.doc.child);
    expect(p.doc.child?.children?.[0]?.$fullPath()).toBe("child.children.0");
  });
});
