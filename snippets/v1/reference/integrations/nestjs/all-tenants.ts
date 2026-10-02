import { Controller, Get } from "@nestjs/common";
import { AllTenants } from "@venloc/typemo-nestjs";
// ---cut---
@Controller("admin")
export class AdminController {
  @AllTenants()
  @Get("orders")
  orders(): string[] {
    return [];
  }
}
