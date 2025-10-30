// src/lib/rules/execute.ts
import { pgPool as pool } from "@/lib/db";
import { processAutomationRules } from "@/lib/rules";

type ExecInput = {
  organizationId: string;
  clientId: string;
  /** rules that matched (event = 'customer_inactive') – from the sweep */
  matchedRuleIds: string[];
};

export async function executeCustomerInactive(input: ExecInput): Promise<{ ok: true }> {
  const { organizationId, clientId, matchedRuleIds } = input;

  // Pull client country (so rules with country filters evaluate correctly)
  const { rows: [c] } = await pool.query(
    `SELECT country, "userId" FROM "clients"
      WHERE "organizationId" = $1 AND id = $2
      LIMIT 1`,
    [organizationId, clientId],
  );

  const country: string | null = c?.country ?? null;
  const userId: string | null = c?.userId ?? null;

  // Run ONLY the matched customer_inactive rules for this client.
  await processAutomationRules({
    organizationId,
    event: "customer_inactive",
    country,
    clientId,
    userId,
    url: null,
    orderId: null,
    variables: {},
    onlyRuleIds: matchedRuleIds,
  });

  return { ok: true };
}
