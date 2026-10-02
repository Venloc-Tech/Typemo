import { afterAll, beforeAll, expect, test } from "bun:test";
import { Module, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypemoExceptionFilter } from "@venloc/typemo-nestjs";
import { TypemoTestingModule } from "@venloc/typemo-nestjs/testing";
@Module({})
class AccountsModule {}
// ---cut---
let app: INestApplication;
let url = "";

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [TypemoTestingModule.forRoot(process.env.MONGO_URI ?? ""), AccountsModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new TypemoExceptionFilter());
  await app.listen(0, "127.0.0.1");
  url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
afterAll(() => app.close());

test("a malformed id is 400", async () => {
  const response = await fetch(`${url}/accounts/not-an-id`);
  expect(response.status).toBe(400);
});
