import type { TopologyDescription } from "mongodb";

/*
 * The state of a client is derived ONLY from public driver events (`topologyDescriptionChanged`) for EVERY
 * topology type. Mongoose emitted disconnected/reconnected for Single and ReplicaSet only and read the
 * driver's internal `client.topology.s.*`.
 */

/**
 * The state of a client.
 *
 * - `idle` — created, `connect()` not called yet;
 * - `connecting` — `connect()` in progress;
 * - `connected` — a data-bearing server is known (standalone, primary/secondary, mongos, load balancer);
 * - `unavailable` — was connected, no data-bearing server is known now (the driver is reconnecting;
 *   operations wait in the driver's server selection, bounded by `timeoutMS`);
 * - `closed` — `close()` was called; operations fail at once.
 *
 * @example
 * ```ts
 * const state: ConnectionState = client.state; // "connected"
 * ```
 */
export type ConnectionState = "idle" | "connecting" | "connected" | "unavailable" | "closed";

/** Derivation of the state from topology descriptions. */
export class TopologyStates {
  /**
   * @param description - The driver's topology description.
   * @returns `true` when the topology knows a server that can serve data.
   */
  static hasDataBearingServer(description: TopologyDescription): boolean {
    return [...description.servers.values()].some((server) => server.isDataBearing);
  }

  /**
   * Tells whether transactions are possible: a replica set (a member reached directly included), a sharded
   * cluster or a load balancer allow them; a topology of standalone servers does not.
   *
   * @param description - The driver's topology description.
   * @returns `true` when transactions are possible, `false` when only standalone servers are known,
   *   `undefined` when nothing is known yet.
   */
  static supportsTransactions(description: TopologyDescription): boolean | undefined {
    switch (description.type) {
      case "ReplicaSetWithPrimary":
      case "ReplicaSetNoPrimary":
      case "Sharded":
      case "LoadBalanced":
        return true;
      default: {
        const types = [...description.servers.values()].map((server) => server.type);
        if (types.some((type) => type === "RSPrimary" || type === "RSSecondary" || type === "Mongos")) return true;
        if (types.length > 0 && types.every((type) => type === "Standalone")) return false;
        return undefined;
      }
    }
  }

  /**
   * @param error - Any thrown value.
   * @returns `true` when it is the server's refusal of a transaction on a standalone `mongod` (code 20,
   *   IllegalOperation).
   */
  static isNoTransactionsError(error: unknown): boolean {
    if (error === null || typeof error !== "object") return false;
    const { code, message } = error as { readonly code?: unknown; readonly message?: unknown };
    return (
      typeof message === "string" &&
      (message.includes("Transaction numbers are only allowed on a replica set member or mongos") ||
        (code === 20 && message.includes("ransaction")))
    );
  }

  /**
   * Computes the state after a topology change (only while the client is open).
   *
   * @param current - The current state.
   * @param description - The new topology description.
   * @returns The next state; `idle` and `closed` never change.
   */
  static next(current: ConnectionState, description: TopologyDescription): ConnectionState {
    if (current === "closed" || current === "idle") return current;
    if (TopologyStates.hasDataBearingServer(description)) return "connected";
    return current === "connecting" ? "connecting" : "unavailable";
  }
}
