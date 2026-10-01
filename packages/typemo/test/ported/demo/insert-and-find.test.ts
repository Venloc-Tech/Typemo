// ported from mongoose test/model.test.js:7761 "saves new documents"

/*
 * Demo-only port: shows the file format and header convention. Ported against the raw
 * `mongodb` driver, not Mongoose or Typemo — `User.bulkSave([...])` becomes
 * `insertMany([...])`, and `User.find().sort('name')` becomes `find().sort({ name: 1 })`.
 * The logic and assertion are unchanged.
 */
import { expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";

// Don't destructure `db` here — it's a getter that `beforeAll` fills in;
// see @venloc/typemo-test-kit's db/lifecycle.test.ts for why.
const mongo = MongoLifecycle.useMongo("ported_demo");

test("saves new documents", async () => {
  const users = mongo.db.collection("users");

  await users.insertMany([{ name: "Hafez1_gh-9673-1" }, { name: "Hafez2_gh-9673-1" }]);

  const found = await users.find().sort({ name: 1 }).toArray();

  expect(found.map((user) => user.name)).toEqual(["Hafez1_gh-9673-1", "Hafez2_gh-9673-1"]);
});
