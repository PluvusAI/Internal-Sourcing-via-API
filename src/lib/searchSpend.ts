import type { ListDetail, OperationView, StoredRead } from "../../server/sourceClient";

export const credits = (n: number): string => n.toFixed(2);

/** What a saved creator has cost so far, once there is one to divide by. */
export function creditsPerSaved(op: OperationView): number | null {
  return op.admittedCount > 0 ? op.sources.influencersClub.credits / op.admittedCount : null;
}

/**
 * A search spending its credits faster than it is finding creators: the sign of filters that may be
 * too tight, while stopping still saves something. Not before a quarter of the credits are gone, so
 * the first page bought does not set it off on its own.
 */
export function spendingAhead(op: OperationView): boolean {
  const { credits: used, creditLimit } = op.sources.influencersClub;
  if (creditLimit <= 0 || op.targetCount <= 0) return false;
  const spent = used / creditLimit;
  return spent >= 0.25 && spent > op.admittedCount / op.targetCount;
}

/** Why a search's free read of our database left creators, in plain words, biggest first. */
const STORED_READ_REASONS: Array<[keyof StoredRead, string]> = [
  ["unproven", "Required filter not proven, usually location or language"],
  ["rejected", "Outside this search’s filters"],
  ["excluded", "On a list you excluded"],
  ["notAFit", "Already judged not a fit for this search"],
  ["noDetails", "No saved details to judge"],
  ["noWordMatch", "Profile doesn’t mention this search’s words"],
  ["overLimit", "Over this search’s limit"],
  ["unusable", "No Influencers Club ID"],
];

export function storedReadReasons(read: StoredRead): Array<{ key: keyof StoredRead; label: string; count: number }> {
  return STORED_READ_REASONS.filter(([key]) => read[key] > 0)
    .map(([key, label]) => ({ key, label, count: read[key] }))
    .sort((a, b) => b.count - a.count);
}

export interface SourceTotals {
  searchCalls: number;
  searchCredits: number;
  creatorsPulled: number;
  databaseChecked: number;
  /** Searches from before the database count was recorded: not part of databaseChecked. */
  unrecordedSearches: number;
  emailCalls: number;
  emailCredits: number;
}

export function sourceTotals(list: Pick<ListDetail, "operations" | "emailLookups">): SourceTotals {
  const totals: SourceTotals = { searchCalls: 0, searchCredits: 0, creatorsPulled: 0, databaseChecked: 0, unrecordedSearches: 0, emailCalls: list.emailLookups.calls, emailCredits: list.emailLookups.credits };
  for (const { sources } of list.operations) {
    totals.searchCalls += sources.influencersClub.calls;
    totals.searchCredits += sources.influencersClub.credits;
    totals.creatorsPulled += sources.influencersClub.creatorsPulled;
    if (sources.database) totals.databaseChecked += sources.database.checked;
    else totals.unrecordedSearches++;
  }
  return totals;
}
