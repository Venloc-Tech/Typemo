import { expectIndexScan } from "@venloc/typemo/testing";

test("поиск счёта по названию идёт по индексу", async () => {
  const Accounts = client.db().model(Account);
  await expectIndexScan(Accounts.find({ title: "Account 1" }), { index: "title_1", maxDocsExamined: 1 });
});
