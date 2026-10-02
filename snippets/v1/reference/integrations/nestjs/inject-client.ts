import { Controller, Get } from "@nestjs/common";
import type { TypemoClient } from "@venloc/typemo";
import { InjectClient } from "@venloc/typemo-nestjs";
// ---cut---
@Controller("health")
export class HealthController {
  constructor(@InjectClient() private readonly client: TypemoClient) {}

  @Get()
  check() {
    return { database: this.client.state };
  }
}
