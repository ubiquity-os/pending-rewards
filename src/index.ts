import { createClient } from "@supabase/supabase-js";
import { PERMIT2_ADDRESS } from "@uniswap/permit2-sdk";
import { Contract } from "ethers";
import { appendFileSync, writeFileSync } from "fs";
import * as path from "path";
import permit2AbiJson from "./abi/permit2.json";
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
      "nonce,partners(wallets(address)),tokens(address,network),users:beneficiary_id(wallets(address)),amount"
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

  const csvHeaders =
    "nonce,amount,partner_address,token_address,network,user_address,is_claimed,token_symbol\n";
  const csvFile = path.join(process.cwd(), "nonce-results.csv");
  writeFileSync(csvFile, csvHeaders);

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

        const csvRow = `${permit.nonce},${permit.amount},${partnerAddress},${tokenAddress},${network},${userAddress},${isClaimed},${tokenSymbol}\n`;
        appendFileSync(csvFile, csvRow);

        return {
          nonce: permit.nonce,
          isClaimed,
          tokenSymbol,
        };
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
  console.log(`Results written to: ${csvFile}`);
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

        const csvRow = `${permit.nonce},${permit.amount},${partnerAddress},${tokenAddress},${network},${userAddress},${isClaimed},${tokenSymbol}\n`;
        appendFileSync(csvFile, csvRow);

        console.log(`✅ Retry successful for permit ${permit.nonce}`);

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.log(`❌ Retry failed for permit ${permit.nonce}:`, error);
      }
    }
  }

  console.log("All done!");
}

main().catch(console.error);
