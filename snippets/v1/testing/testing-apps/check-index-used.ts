import { expectIndexScan } from "@venloc/typemo/testing";

test("finding an account by title uses the index", async () => {
  const Accounts = client.db().model(Account);
  await expectIndexScan(Accounts.find({ title: "Account 1" }), { index: "title_1", maxDocsExamined: 1 });
});
