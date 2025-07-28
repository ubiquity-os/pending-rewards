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
    location_id: number;
    wallets: {
      address: string;
    };
    locations?: {
      node_id?: string;
      node_url?: string;
      user_id?: number;
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
  const permit2Address = PERMIT2_ADDRESS;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }
  const supabase = createClient<Database>(supabaseUrl, supabaseKey);

  const {
    data,
    error,
  }: { data: PermitRow[] | null; error: SupabaseError | null } = (await supabase
    .from("permits")
    .select(
      "nonce,partners(wallets(address)),tokens(address,network),users:beneficiary_id(id,location_id,wallets(address),locations(node_id,node_url,user_id)),amount"
    )
    .not("partners", "is", null)
    .not("tokens", "is", null)
    .not("users", "is", null)) as {
    data: PermitRow[] | null;
    error: SupabaseError | null;
  };

  if (error) {
    console.error("Error fetching permits:", error);
    return;
  }

  if (!data) {
    console.log("No permits found");
    return;
  }

  console.log(`Found ${data.length} permits to check`);

  // First, collect all unique GitHub user IDs
  const githubUserIds = new Set<number>();
  for (const permit of data) {
    const userId = permit.users?.locations?.user_id;
    if (userId) {
      githubUserIds.add(userId);
    }
  }

  console.log(`Fetching ${githubUserIds.size} GitHub usernames...`);
  const githubUsernames = await fetchGitHubUsernames(Array.from(githubUserIds));

  const permits: PermitData[] = [];
  const failedChecks: PermitRow[] = [];
  const batchSize = 20;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    console.log(
      `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(data.length / batchSize)} (${batch.length} items)`
    );

    const batchPromises = batch.map(async (permit) => {
      try {
        const partnerAddress = permit.partners?.wallets?.address;
        const tokenAddress = permit.tokens?.address;
        const userAddress = permit.users?.wallets?.address;
        const network = permit.tokens?.network;
        const githubUserId = permit.users?.locations?.user_id;
        const userName = githubUserId
          ? githubUsernames.get(githubUserId) || `user-${githubUserId}`
          : "Unknown User";

        if (!partnerAddress || !tokenAddress || !userAddress || !network) {
          console.log(
            `Skipping permit ${permit.nonce} - missing required data`
          );
          return null;
        }

        const permit2Contract = getContract(
          permit2Address,
          permit2Abi,
          network
        );
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
          console.log(
            `Could not fetch symbol for token ${tokenAddress}:`,
            symbolError
          );
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

        permits.push(permitData);

        return permitData;
      } catch (error) {
        console.log(`Failed to check permit ${permit.nonce}:`, error);
        failedChecks.push(permit);
        return null;
      }
    });

    const results = await Promise.all(batchPromises);
    const successCount = results.filter((r) => r !== null).length;
    console.log(`Batch completed: ${successCount}/${batch.length} successful`);
  }

  console.log(`\nProcessing complete!`);
  console.log(`Failed checks: ${failedChecks.length}`);

  if (failedChecks.length > 0) {
    console.log("\nRetrying failed checks...");

    for (const permit of failedChecks) {
      try {
        console.log(`Retrying permit ${permit.nonce}...`);

        const partnerAddress = permit.partners?.wallets?.address;
        const tokenAddress = permit.tokens?.address;
        const userAddress = permit.users?.wallets?.address;
        const network = permit.tokens?.network;
        const githubUserId = permit.users?.locations?.user_id;
        const userName = githubUserId
          ? githubUsernames.get(githubUserId) || `user-${githubUserId}`
          : "Unknown User";

        if (!partnerAddress || !tokenAddress || !userAddress || !network) {
          console.log(
            `Skipping permit ${permit.nonce} - missing required data`
          );
          continue;
        }

        const permit2Contract = getContract(
          permit2Address,
          permit2Abi,
          network
        );
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
          console.log(
            `Could not fetch symbol for token ${tokenAddress}:`,
            symbolError
          );
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

        permits.push(permitData);

        console.log(`✅ Retry successful for permit ${permit.nonce}`);

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.log(`❌ Retry failed for permit ${permit.nonce}:`, error);
      }
    }
  }

  const unclaimedPermits = permits.filter((p) => !p.isClaimed);

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

  console.log(`\nMarkdown results written to: ${mdFile}`);
  console.log("All done!");
}

main().catch(console.error);
