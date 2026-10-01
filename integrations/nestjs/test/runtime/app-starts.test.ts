// N1: a Nest application with TypemoModule starts on the real server and closes its client.
import { expect, test } from "bun:test";
import { Module } from "@nestjs/common";
import { TypemoClient } from "@venloc/typemo";
import { getClientToken, TypemoModule } from "../../src/index.ts";
import { NestTest } from "../support/nest-test.ts";

test("a Nest application with TypemoModule.forRoot starts, provides a connected client and closes it", async () => {
  @Module({ imports: [TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("starts") })] })
  class AppModule {}
  const ref = await NestTest.module([AppModule]);
  const client = ref.get<TypemoClient>(getClientToken());
  expect(client).toBeInstanceOf(TypemoClient);
  expect(client.state).toBe("connected");
  await ref.close();
  expect(client.state).toBe("closed");
});
