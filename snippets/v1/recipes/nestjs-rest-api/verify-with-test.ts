import { afterAll, beforeAll, expect, test } from "bun:test";
import { type INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PolicyInterceptor, TypemoExceptionFilter } from "@venloc/typemo-nestjs";
import { TypemoTestingModule } from "@venloc/typemo-nestjs/testing";
@Module({})
class AccountsModule {}
// ---cut---
let app: INestApplication;
let url = "";
const call = (method: string, path: string, body?: unknown, org = "acme") =>
  fetch(`${url}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-org": org },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [TypemoTestingModule.forRoot(process.env.MONGO_URI ?? ""), AccountsModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new TypemoExceptionFilter());
  app.useGlobalInterceptors(new PolicyInterceptor({ tenant: (request) => request.headers["x-org"] }));
  await app.listen(0, "127.0.0.1");
  url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
afterAll(() => app.close());

test("an organization sees only its accounts", async () => {
  await call("POST", "/accounts", { title: "Main", balance: 100 });
  expect(await (await call("GET", "/accounts", undefined, "globex")).json()).toEqual([]);
});
