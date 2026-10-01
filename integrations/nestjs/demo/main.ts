// The demo: `bun run demo` (in integrations/nestjs). A Nest application on a MongoDB replica set (MONGO_URI, or a
// one-node replica set started for the demo), driven over HTTP step by step; every step prints what happened.
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MongoHarness } from "@venloc/typemo-test-kit";
import { PolicyInterceptor, TypemoExceptionFilter, TypemoModule } from "../src/index.ts";
import { BankModule } from "./bank.ts";

const own = process.env.MONGO_URI === undefined;
if (own) await MongoHarness.ensureStarted();
const uri = process.env.MONGO_URI ?? MongoHarness.getUri();
const dbName = `typemo_nest_demo_${Date.now()}`;

@Module({ imports: [TypemoModule.forRoot(uri, { dbName, sync: "init", retryAttempts: 1 }), BankModule] })
class AppModule {}

const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
app.useGlobalFilters(new TypemoExceptionFilter());
app.useGlobalInterceptors(new PolicyInterceptor({ tenant: (request) => request.headers["x-org"] }));
await app.listen(0, "127.0.0.1");
const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

const call = async (method: string, path: string, body?: unknown, org = "acme") => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-org": org },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};
const step = (title: string, value: unknown) => console.log(`${title}: ${JSON.stringify(value)}`);

try {
  const ann = await call("POST", "/customers", { email: "ann@example.com", name: "Ann" });
  step("1. customer created", { status: ann.status, name: ann.body.name });

  const main = await call("POST", "/accounts", { title: "Main", balance: 100, owner: ann.body._id });
  const spare = await call("POST", "/accounts", { title: "Spare", balance: 0 });
  step("2. accounts opened (tenant from the x-org header)", [main.body.title, spare.body.tenantId]);

  const savings = await call("POST", "/accounts/savings", { title: "Savings", rate: 2 });
  step("3. a savings account (discriminator)", { kind: savings.body.__t, rate: savings.body.rate });

  const populated = await call("GET", `/accounts/${main.body._id as string}`);
  step("4. read by id with the owner populated", (populated.body.owner as { name: string }).name);

  await call("POST", "/accounts/transfer", { from: main.body._id, to: spare.body._id, amount: 30 });
  const after = await call("GET", "/accounts");
  step(
    "5. transfer of 30 in a transaction",
    (after.body as unknown as { title: string; balance: number }[]).map((a) => `${a.title}=${a.balance}`),
  );

  const failed = await call("POST", "/accounts/transfer", { from: spare.body._id, to: main.body._id, amount: 500 });
  const unchanged = await call("GET", "/accounts");
  step("6. a transfer of 500 breaks min: 0 and rolls back", {
    status: failed.status,
    balances: (unchanged.body as unknown as { title: string; balance: number }[]).map((a) => `${a.title}=${a.balance}`),
  });

  step("7. a malformed id", (await call("GET", "/accounts/not-an-id")).body.message);
  step(
    "8. an invalid body",
    (await call("POST", "/accounts", { title: "Bad", balance: -5, color: "red" })).body.errors,
  );
  step("9. a duplicate email", (await call("POST", "/customers", { email: "ann@example.com", name: "Ann" })).body);

  await call("POST", "/accounts", { title: "Globex main", balance: 10 }, "globex");
  step(
    "10. another tenant sees only its accounts",
    ((await call("GET", "/accounts", undefined, "globex")).body as unknown as { title: string }[]).map((a) => a.title),
  );
  step("11. @AllTenants counts every tenant", (await call("GET", "/accounts/admin/count")).body);
  console.log("demo: done");
} finally {
  await app.close();
  if (own) await MongoHarness.stop();
}
