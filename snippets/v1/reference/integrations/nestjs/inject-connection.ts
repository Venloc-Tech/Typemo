import { Injectable } from "@nestjs/common";
import type { Connection } from "@venloc/typemo";
import { InjectConnection } from "@venloc/typemo-nestjs";
// ---cut---
@Injectable()
export class ReportsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectConnection({ db: "archive" }) private readonly archive: Connection,
  ) {}
}
