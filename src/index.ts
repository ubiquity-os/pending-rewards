import { createClient } from "@supabase/supabase-js";
import { PERMIT2_ADDRESS } from "@uniswap/permit2-sdk";
import { Contract } from "ethers";
import { writeFileSync } from "fs";
import * as path from "path";
import permit2AbiJson from "./abi/permit2.json";
import { getPartnerAllowlist } from "./helpers/config";
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
import { fetchAllPermits, PermitRow } from "./helpers/supabase";
import {
  ERC20_ABI,
  Erc20Wrapper,
  getContract,
  Permit2Wrapper,
} from "./helpers/web3";
import { Database } from "./types/database";
import { ContractAbi } from "./types/permit2";

const permit2Abi = permit2AbiJson as ContractAbi;

async function main() {
  const logger = new Logger();
  const permit2Address = PERMIT2_ADDRESS;

  logger.section("Pending Rewards Checker - Permit Analysis");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    logger.error("Missing Supabase environment variables");
    throw new Error("Missing Supabase environment variables");
  }
  const supabase = createClient<Database>(supabaseUrl, supabaseKey);

  const argv = process.argv.slice(2);
  const walletsFromArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--wallet" || arg === "-w") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        next
          .split(/[,\n]/)
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
          .forEach((v) => walletsFromArgs.push(v));
        i++;
      }
    } else if (arg.startsWith("--wallet=") || arg.startsWith("-w=")) {
      const val = arg.split("=")[1] || "";
      val
        .split(/[,\n]/)
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
        .forEach((v) => walletsFromArgs.push(v));
    }
  }

  const partnerAllowlist = getPartnerAllowlist(logger, walletsFromArgs);
  logger.startSpinner("Fetching permits from database...");
  const { data: fetchedData, error } = await fetchAllPermits(
    supabase,
    logger,
    partnerAllowlist.size > 0 ? Array.from(partnerAllowlist) : undefined
  );

  if (error) {
    logger.stopSpinner("Failed to fetch permits", true);
    logger.error(`Database error: ${error.message}`);
    return;
  }

  if (!fetchedData) {
    logger.stopSpinner("No permits found in database", true);
    return;
  }

  const data = fetchedData;
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
  const completed = { count: 0 }; // Use object for shared reference
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
        completed.count++;
        logger.updateSpinner(
          `Processing permits... ${completed.count}/${data.length} completed`
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
      } catch (symbolError) {}

      const permitData: PermitData = {
        nonce: parseInt(permit.nonce, 10),
        amount: permit.amount,
        partnerAddress,
        tokenAddress,
        tokenSymbol,
        network,
        userAddress,
        userName,
        isClaimed,
      };

      completed.count++;
      logger.updateSpinner(
        `Processing permits... ${completed.count}/${data.length} completed`
      );

      return permitData;
    } catch (error) {
      completed.count++;
      console.log(
        `[Error] Failed permit ${completed.count}/${data.length}:`,
        error instanceof Error ? error.message : String(error)
      );
      logger.updateSpinner(
        `Processing permits... ${completed.count}/${data.length} completed`
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
    const retryCompleted = { count: 0 }; // Use object for shared reference

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
            retryCompleted.count++;
            logger.updateSpinner(
              `Retrying permits... ${retryCompleted.count}/${failedChecks.length}`
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
          } catch (symbolError) {}

          const permitData: PermitData = {
            nonce: parseInt(permit.nonce, 10),
            amount: permit.amount,
            partnerAddress,
            tokenAddress,
            tokenSymbol,
            network,
            userAddress,
            userName,
            isClaimed,
          };

          retryCompleted.count++;
          logger.updateSpinner(
            `Retrying permits... ${retryCompleted.count}/${failedChecks.length}`
          );
          retrySuccessCount++;
          return permitData;
        } catch (error) {
          retryCompleted.count++;
          logger.updateSpinner(
            `Retrying permits... ${retryCompleted.count}/${failedChecks.length}`
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

  const txtFile = path.join(process.cwd(), "pending-rewards.txt");
  writeFileSync(txtFile, markdownContent);
  logger.stopSpinner("Results written to pending-rewards.txt");

  logger.fileOutput(txtFile);
}

main().catch(console.error);
