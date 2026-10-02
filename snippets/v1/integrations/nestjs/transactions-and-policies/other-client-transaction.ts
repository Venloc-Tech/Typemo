import { Injectable } from "@nestjs/common";
import { Transactional } from "@venloc/typemo-nestjs";
// ---cut---
@Injectable()
export class BillingService {
  @Transactional({ client: "billing", timeoutMS: 5000 })
  async charge(): Promise<void> {}
}
