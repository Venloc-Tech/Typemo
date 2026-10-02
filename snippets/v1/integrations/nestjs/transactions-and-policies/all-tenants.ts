import { Controller, Get } from "@nestjs/common";
import { Entity, type Model, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";
import { AllTenants, InjectModel } from "@venloc/typemo-nestjs";
@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}
// ---cut---
@Controller("admin/orders")
export class AdminOrdersController {
  constructor(@InjectModel(Order) private readonly orders: Model<Order>) {}

  @AllTenants()
  @Get()
  async all() {
    return (await this.orders.find().sort({ number: 1 }).plain()).map((order) => `${order.tenantId}:${order.number}`);
  }
}
