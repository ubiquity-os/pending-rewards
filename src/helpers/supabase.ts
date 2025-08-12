import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../types/database";
import { Logger } from "./logger";

export interface SupabaseError {
  message: string;
  details?: string;
  hint?: string;
  code?: string;
}

export interface PermitRow {
  nonce: string;
  amount: string;
  partners: {
    wallets: {
      address: string | null;
    } | null;
  } | null;
  tokens: {
    address: string;
    network: number;
  } | null;
  users: {
    id: number;
    wallets: {
      address: string | null;
    };
  };
}

const BATCH_SIZE = 1000;

/**
 * Fetches all permits from the database using pagination to overcome Supabase's default 1000 row limit.
 * This function will automatically fetch all available permits by making multiple requests in batches.
 *
 * @param supabase - The Supabase client instance
 * @param logger - Logger instance for progress updates
 * @param partnerWalletAllowlist - The list of allowed wallets
 * @returns Promise resolving to all permits or an error
 */
export async function fetchAllPermits(
  supabase: SupabaseClient<Database>,
  logger: Logger,
  partnerWalletAllowlist?: string[],
): Promise<{ data: PermitRow[] | null; error: SupabaseError | null }> {
  const allowlistSet = partnerWalletAllowlist
    ? new Set(partnerWalletAllowlist.filter((a) => a.length > 0))
    : null;
  let allPermits: PermitRow[] = [];
  let hasMore = true;
  let currentPage = 0;
  let totalFetched = 0;

  // Paginate through all permits in batches of 1000
  while (hasMore) {
    const startRange = currentPage * BATCH_SIZE;
    const endRange = startRange + BATCH_SIZE - 1;

    logger.updateSpinner(
      `Fetching permits (${totalFetched} fetched so far)...`,
    );

    let query = supabase
      .from("permits")
      .select(
        "nonce,partners(wallets(address)),tokens(address,network),users:beneficiary_id(id,wallets(address)),amount",
      )
      .not("partners", "is", null)
      .not("tokens", "is", null)
      .not("users", "is", null)
      .range(startRange, endRange)
      .order("id");

    if (allowlistSet && allowlistSet.size > 0) {
      query = query.filter(
        "partners.wallets.address",
        "in",
        `(${Array.from(allowlistSet).join(",")})`,
      );
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    allPermits = allPermits.concat(data);
    totalFetched += data.length;

    // If we got less than BATCH_SIZE, we've reached the end
    if (data.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      currentPage++;
    }
  }

  return { data: allPermits, error: null };
}
