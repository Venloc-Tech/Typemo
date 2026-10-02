import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import type { TypemoClient } from "@venloc/typemo";
import { InjectClient } from "@venloc/typemo-nestjs";
// ---cut---
@Controller("health")
export class HealthController {
  constructor(@InjectClient() private readonly client: TypemoClient) {}

  @Get()
  check() {
    if (this.client.state !== "connected") throw new ServiceUnavailableException({ database: this.client.state });
    return { database: "connected" };
  }
}
