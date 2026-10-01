/* Tests `FailPointHelpers`: the `failCommand` fail point on a real server. */
import { expect, test } from "bun:test";
import { MongoLifecycle } from "../../src/db/lifecycle.ts";
import { FailPointHelpers } from "../../src/failpoints/fail-point.ts";

/* See db/lifecycle.test.ts for why `db`/`client` aren't destructured here. */
const mongo = MongoLifecycle.useMongo("failpoint_demo");

test("failCommand injects the requested error code into the matching command", async () => {
  const handle = await FailPointHelpers.configureFailCommand(mongo.client, {
    failCommands: ["insert"],
    /* 112 is WriteConflict. */
    errorCode: 112,
    times: 1,
  });

  try {
    await expect(mongo.db.collection("fp").insertOne({ n: 1 })).rejects.toMatchObject({ code: 112 });
  } finally {
    await handle.disable();
  }

  /* The failpoint only fired once (`times: 1`) and is now disabled: a
     second insert must go through normally. */
  await mongo.db.collection("fp").insertOne({ n: 2 });
  expect(await mongo.db.collection("fp").countDocuments()).toBe(1);
});

test("failCommand can attach error labels, e.g. TransientTransactionError", async () => {
  const handle = await FailPointHelpers.configureFailCommand(mongo.client, {
    failCommands: ["insert"],
    errorCode: 112,
    errorLabels: ["TransientTransactionError"],
    times: 1,
  });

  try {
    const error = await mongo.db
      .collection("fp2")
      .insertOne({ n: 1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as { errorLabels?: string[] }).errorLabels).toContain("TransientTransactionError");
  } finally {
    await handle.disable();
  }
});

test("blockConnection simulates a slow command (used for timeout scenarios)", async () => {
  const handle = await FailPointHelpers.configureFailCommand(mongo.client, {
    failCommands: ["find"],
    blockConnection: true,
    blockTimeMS: 200,
    times: 1,
  });

  try {
    const start = Date.now();
    await mongo.db.collection("fp3").find({}).toArray();
    expect(Date.now() - start).toBeGreaterThanOrEqual(150);
  } finally {
    await handle.disable();
  }
});
