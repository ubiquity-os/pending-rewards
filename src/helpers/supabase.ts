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
 * @returns Promise resolving to all permits or an error
 */
export async function fetchAllPermits(
  supabase: SupabaseClient<Database>,
  logger: Logger
): Promise<{ data: PermitRow[] | null; error: SupabaseError | null }> {
  let allPermits: PermitRow[] = [];
  let hasMore = true;
  let currentPage = 0;
  let totalFetched = 0;

  // Paginate through all permits in batches of 1000
  while (hasMore) {
    const startRange = currentPage * BATCH_SIZE;
    const endRange = startRange + BATCH_SIZE - 1;

    logger.updateSpinner(
      `Fetching permits (${totalFetched} fetched so far)...`
    );

    const { data, error } = await supabase
      .from("permits")
      .select(
        "nonce,partners(wallets(address)),tokens(address,network),users:beneficiary_id(id,wallets(address)),amount"
      )
      .not("partners", "is", null)
      .not("tokens", "is", null)
      .not("users", "is", null)
      .range(startRange, endRange)
      .order("id"); // Add consistent ordering for reliable pagination

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

/**
 * Generic function to fetch all rows with pagination for any Supabase query
 * Usage example:
 *
 * const allRows = await fetchAllRowsPaginated(
 *   supabase,
 *   (client, start, end) => client
 *     .from("permits")
 *     .select("*")
 *     .not("partners", "is", null)
 *     .range(start, end)
 *     .order("id"),
 *   logger,
 *   "permits"
 * );
 */
export async function fetchAllRowsPaginated<T>(
  supabase: SupabaseClient<Database>,
  queryBuilder: (
    client: SupabaseClient<Database>,
    startRange: number,
    endRange: number
  ) => any,
  logger: Logger,
  entityName: string = "rows"
): Promise<{ data: T[] | null; error: SupabaseError | null }> {
  let allRows: T[] = [];
  let hasMore = true;
  let currentPage = 0;
  let totalFetched = 0;

  while (hasMore) {
    const startRange = currentPage * BATCH_SIZE;
    const endRange = startRange + BATCH_SIZE - 1;

    logger.updateSpinner(
      `Fetching ${entityName} (${totalFetched} fetched so far)...`
    );

    const { data, error } = await queryBuilder(supabase, startRange, endRange);

    if (error) {
      return { data: null, error };
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    allRows = allRows.concat(data);
    totalFetched += data.length;

    // If we got less than BATCH_SIZE, we've reached the end
    if (data.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      currentPage++;
    }
  }

  return { data: allRows, error: null };
}
