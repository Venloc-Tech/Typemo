import type { InstrumentationSubscriber, Subscription } from "@venloc/typemo";

interface InstrumentTarget {
  readonly instrument: (subscriber: InstrumentationSubscriber) => Subscription;
}

interface Stat {
  count: number;
  errors: number;
  totalMS: number;
}

export class OperationStats {
  readonly #stats = new Map<string, Stat>();

  static instrument(target: InstrumentTarget): { stats: OperationStats; subscription: Subscription } {
    const stats = new OperationStats();
    const subscription = target.instrument({
      steps: false, // steps are not needed: the core does not build them
      handle: (event) => {
        if (event.type !== "operation.end" && event.type !== "operation.error") return;
        const key = `${event.model ?? `database ${event.database}`}.${event.operation}`;
        const stat = stats.#stats.get(key) ?? { count: 0, errors: 0, totalMS: 0 };
        stat.count += 1;
        stat.totalMS += event.durationMS;
        if (event.type === "operation.error") stat.errors += 1;
        stats.#stats.set(key, stat);
      },
    });
    return { stats, subscription };
  }

  snapshot(): Record<string, Stat> {
    return Object.fromEntries(this.#stats);
  }
}
