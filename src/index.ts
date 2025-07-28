import { createClient } from "@supabase/supabase-js";
import { PERMIT2_ADDRESS } from "@uniswap/permit2-sdk";
import { Contract } from "ethers";
import { writeFileSync } from "fs";
import * as path from "path";
import permit2AbiJson from "./abi/permit2.json";
import {
  calculateUserWalletTotals,
  calculateWalletTotals,
  generateUserRewardsTable,
  generateWalletTotalsTable,
  getAllUniqueTokensFromMaps,
  PermitData,
} from "./helpers/formatting";
import { fetchGitHubUsernames } from "./helpers/github";
import { Logger } from "./helpers/logger";
import {
  ERC20_ABI,
  Erc20Wrapper,
  getContract,
  Permit2Wrapper,
} from "./helpers/web3";
import { Database } from "./types/database";
import { ContractAbi } from "./types/permit2";

const permit2Abi = permit2AbiJson as ContractAbi;

interface PermitRow {
  nonce: number;
  amount: string;
  partners: {
    wallets: {
      address: string;
    };
  };
  tokens: {
    address: string;
    network: number;
  };
  users: {
    id: number;
    wallets: {
      address: string;
    };
  };
}

interface SupabaseError {
  message: string;
  details?: string;
  hint?: string;
  code?: string;
}

async function main() {
  const logger = new Logger();
  const permit2Address = PERMIT2_ADDRESS;

  logger.section("Nonce Checker - Permit Analysis");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    logger.error("Missing Supabase environment variables");
    throw new Error("Missing Supabase environment variables");
  }
  const supabase = createClient<Database>(supabaseUrl, supabaseKey);

  logger.startSpinner("Fetching permits from database...");
  const {
    data,
    error,
  }: { data: PermitRow[] | null; error: SupabaseError | null } = (await supabase
    .from("permits")
    .select(
      "nonce,partners(wallets(address)),tokens(address,network),users:beneficiary_id(id,wallets(address)),amount"
    )
    .not("partners", "is", null)
    .not("tokens", "is", null)
    .not("users", "is", null)) as {
    data: PermitRow[] | null;
    error: SupabaseError | null;
  };

  if (error) {
    logger.stopSpinner("Failed to fetch permits", true);
    logger.error(`Database error: ${error.message}`);
    return;
  }

  if (!data) {
    logger.stopSpinner("No permits found in database", true);
    return;
  }

  logger.stopSpinner(`Found ${data.length} permits to analyze`);

  // First, collect all unique GitHub user IDs
  const githubUserIds = new Set<number>();
  for (const permit of data) {
    const userId = permit.users?.id;
    if (userId) {
      githubUserIds.add(userId);
    }
  }

  logger.startSpinner(`Fetching GitHub usernames...`);
  const githubUsernames = await fetchGitHubUsernames(Array.from(githubUserIds));
  logger.stopSpinner(`GitHub usernames retrieved`);

  logger.section("Permit Processing");
  const permits: PermitData[] = [];
  const failedChecks: PermitRow[] = [];
  let completedCount = 0;
  let retrySuccessCount = 0;

  logger.startSpinner("Processing permits in parallel...");

  // Process all permits in parallel with progress tracking
  const processPermit = async (
    permit: PermitRow
  ): Promise<PermitData | null> => {
    try {
      const partnerAddress = permit.partners?.wallets?.address;
      const tokenAddress = permit.tokens?.address;
      const userAddress = permit.users?.wallets?.address;
      const network = permit.tokens?.network;
      const githubUserId = permit.users?.id;
      const userName = githubUserId
        ? githubUsernames.get(githubUserId) || `user-${githubUserId}`
        : "Unknown User";

      if (!partnerAddress || !tokenAddress || !userAddress || !network) {
        completedCount++;
        logger.updateSpinner(
          `Processing permits... ${completedCount}/${data.length} completed`
        );
        return null;
      }

      const permit2Contract = getContract(permit2Address, permit2Abi, network);
      const permit2Wrapper = new Permit2Wrapper(permit2Contract as Contract);

      const isClaimed = await permit2Wrapper.isNonceClaimed(
        partnerAddress,
        permit.nonce
      );

      let tokenSymbol = "UNKNOWN";
      try {
        const tokenContract = getContract(tokenAddress, ERC20_ABI, network);
        const erc20Wrapper = new Erc20Wrapper(tokenContract as Contract);
        tokenSymbol = await erc20Wrapper.symbol();
      } catch (symbolError) {
        // Token symbol fetch failed - continue with UNKNOWN
      }

      const permitData: PermitData = {
        nonce: permit.nonce,
        amount: permit.amount,
        partnerAddress,
        tokenAddress,
        tokenSymbol,
        network,
        userAddress,
        userName,
        isClaimed,
      };

      completedCount++;
      logger.updateSpinner(
        `Processing permits... ${completedCount}/${data.length} completed`
      );

      return permitData;
    } catch (error) {
      completedCount++;
      logger.updateSpinner(
        `Processing permits... ${completedCount}/${data.length} completed`
      );
      failedChecks.push(permit);
      return null;
    }
  };

  // Process all permits in parallel
  const results = await Promise.all(data.map(processPermit));

  // Collect successful results
  results.forEach((result) => {
    if (result) {
      permits.push(result);
    }
  });

  logger.stopSpinner(
    `Completed: ${permits.length}/${data.length} permits processed successfully`
  );

  if (failedChecks.length > 0) {
    logger.startSpinner(`Retrying ${failedChecks.length} failed permits...`);
    let retryCompleted = 0;

    const retryResults = await Promise.all(
      failedChecks.map(async (permit) => {
        try {
          const partnerAddress = permit.partners?.wallets?.address;
          const tokenAddress = permit.tokens?.address;
          const userAddress = permit.users?.wallets?.address;
          const network = permit.tokens?.network;
          const githubUserId = permit.users?.id;
          const userName = githubUserId
            ? githubUsernames.get(githubUserId) || `user-${githubUserId}`
            : "Unknown User";

          if (!partnerAddress || !tokenAddress || !userAddress || !network) {
            retryCompleted++;
            logger.updateSpinner(
              `Retrying permits... ${retryCompleted}/${failedChecks.length}`
            );
            return null;
          }

          const permit2Contract = getContract(
            permit2Address,
            permit2Abi,
            network
          );
          const permit2Wrapper = new Permit2Wrapper(
            permit2Contract as Contract
          );

          const isClaimed = await permit2Wrapper.isNonceClaimed(
            partnerAddress,
            permit.nonce
          );

          let tokenSymbol = "UNKNOWN";
          try {
            const tokenContract = getContract(tokenAddress, ERC20_ABI, network);
            const erc20Wrapper = new Erc20Wrapper(tokenContract as Contract);
            tokenSymbol = await erc20Wrapper.symbol();
          } catch (symbolError) {
            // Token symbol fetch failed - continue with UNKNOWN
          }

          const permitData: PermitData = {
            nonce: permit.nonce,
            amount: permit.amount,
            partnerAddress,
            tokenAddress,
            tokenSymbol,
            network,
            userAddress,
            userName,
            isClaimed,
          };

          retryCompleted++;
          logger.updateSpinner(
            `Retrying permits... ${retryCompleted}/${failedChecks.length}`
          );
          retrySuccessCount++;
          return permitData;
        } catch (error) {
          retryCompleted++;
          logger.updateSpinner(
            `Retrying permits... ${retryCompleted}/${failedChecks.length}`
          );
          return null;
        }
      })
    );

    // Add successful retries to permits
    retryResults.forEach((result) => {
      if (result) {
        permits.push(result);
      }
    });

    logger.stopSpinner(
      `Retries completed: ${retrySuccessCount}/${failedChecks.length} successful`
    );
  }

  const unclaimedPermits = permits.filter((p) => !p.isClaimed);
  const claimedPermits = permits.filter((p) => p.isClaimed);

  logger.section("Final Results");
  logger.info(`Total permits processed: ${permits.length}`);
  logger.info(`Claimed permits: ${claimedPermits.length}`);
  logger.info(`Unclaimed permits: ${unclaimedPermits.length}`);
  logger.info(
    `Final failed checks: ${failedChecks.length - retrySuccessCount}`
  );

  if (unclaimedPermits.length === 0) {
    logger.info("No unclaimed permits found - skipping report generation");
    return;
  }

  logger.startSpinner("Generating wallet toppings analysis...");
  const walletToppings = calculateWalletTotals(
    unclaimedPermits,
    (permit) => permit.partnerAddress
  );

  const userRewards = calculateUserWalletTotals(unclaimedPermits);

  const allUniqueTokens = getAllUniqueTokensFromMaps(
    walletToppings,
    userRewards
  );

  const walletToppingsTable = generateWalletTotalsTable(
    "Wallet Toppings",
    walletToppings,
    allUniqueTokens
  );

  const userRewardsTable = generateUserRewardsTable(
    "User Rewards",
    userRewards,
    allUniqueTokens
  );
  logger.stopSpinner("Analysis tables generated");

  logger.startSpinner("Writing results to markdown file...");
  const markdownContent = `# Pending Rewards

${walletToppingsTable}

${userRewardsTable}

## Summary

- Total permits processed: ${permits.length}
- Failed checks: ${failedChecks.length}
- Claimed permits: ${permits.filter((p) => p.isClaimed).length}
- Unclaimed permits: ${unclaimedPermits.length}
`;

  const mdFile = path.join(process.cwd(), "pending-rewards.md");
  writeFileSync(mdFile, markdownContent);
  logger.stopSpinner("Results written to pending-rewards.md");

  logger.fileOutput(mdFile);
}

main().catch(console.error);
