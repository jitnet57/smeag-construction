import type { ContributionTable } from "@brightem/shared";

/**
 * Compute a statutory contribution (SSS, PhilHealth, Pag-IBIG) based on a salary
 * basis and the contribution table mode (rate or bracket).
 *
 * For rate mode: contribution = basis × ratePct, subject to min/max bounds.
 * For bracket mode: find the bracket containing the basis and use employeeShare amount.
 *
 * @param table - The contribution table (rate or bracket mode)
 * @param monthlyBasis - Annualized or monthly salary basis for lookup
 * @param periodBasis - Salary basis for the actual pay period (usually monthly/~4.33)
 * @returns The employee's contribution amount in the current period
 */
export function computeContribution(
  table: ContributionTable,
  monthlyBasis: number,
  periodBasis: number
): number {
  if (table.mode === "rate") {
    if (table.ratePct === undefined) {
      return 0;
    }
    // Apply rate to period basis, respecting bounds
    let amount = periodBasis * table.ratePct;
    if (table.min !== undefined) {
      amount = Math.max(amount, table.min);
    }
    if (table.max !== undefined) {
      amount = Math.min(amount, table.max);
    }
    return amount;
  }

  if (table.mode === "bracket") {
    if (!table.brackets || table.brackets.length === 0) {
      return 0;
    }
    // Find the bracket that contains monthlyBasis
    for (const bracket of table.brackets) {
      const isInRange =
        monthlyBasis >= bracket.min &&
        (bracket.max === null || monthlyBasis <= bracket.max);
      if (isInRange) {
        return bracket.employeeShare;
      }
    }
    // If no bracket matches, return 0
    return 0;
  }

  return 0;
}
