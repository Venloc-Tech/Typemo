export const balanceRow = {
  "~standard": {
    version: 1 as const,
    vendor: "app",
    validate: (value: unknown) => {
      const row = value as { owner?: unknown; balance?: unknown };
      if (typeof row.owner !== "string") return { issues: [{ message: "owner must be a string", path: ["owner"] }] };
      if (typeof row.balance !== "number") return { issues: [{ message: "balance must be a number", path: ["balance"] }] };
      return { value: { owner: row.owner, balance: row.balance } };
    },
    types: undefined as unknown as { input: unknown; output: { owner: string; balance: number } },
  },
};
