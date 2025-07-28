import { BigNumber, Contract, providers } from "ethers";
import { ContractAbi } from "../types/permit2";

export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

const providerCache = new Map<number, providers.JsonRpcProvider>();
const contractCache = new Map<string, Contract>();

function getProvider(networkId: number): providers.JsonRpcProvider {
  const cached = providerCache.get(networkId);
  if (cached) {
    return cached;
  }

  const rpcUrl = `https://rpc.ubq.fi/${networkId}`;

  // Create provider with timeout settings
  const provider = new providers.JsonRpcProvider({
    url: rpcUrl,
    timeout: 15000, // 15 second timeout
  });

  providerCache.set(networkId, provider);
  console.log(`[RPC] Connected to network ${networkId}: ${rpcUrl}`);
  return provider;
}

export function getContract(
  address: string,
  abi: ContractAbi | string[],
  networkId: number
): Contract {
  const cacheKey = `${address}-${networkId}`;
  const cached = contractCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const provider = getProvider(networkId);
  const contract = new Contract(address, abi, provider);
  contractCache.set(cacheKey, contract);
  return contract;
}

export class Erc20Wrapper {
  constructor(private _contract: Contract) {}

  async symbol(): Promise<string> {
    try {
      const startTime = Date.now();
      const symbol = await this._contract.symbol();
      const duration = Date.now() - startTime;

      if (duration > 3000) {
        console.log(
          `[ERC20] Slow token symbol fetch (${duration}ms): ${symbol}`
        );
      }

      return symbol;
    } catch (error) {
      console.error("[ERC20] Error fetching token symbol:", error);
      return "UNKNOWN";
    }
  }

  async name(): Promise<string> {
    try {
      return await this._contract.name();
    } catch (error) {
      console.error("Error fetching token name:", error);
      return "Unknown Token";
    }
  }

  async decimals(): Promise<number> {
    try {
      return await this._contract.decimals();
    } catch (error) {
      console.error("Error fetching token decimals:", error);
      return 18;
    }
  }
}

export class Permit2Wrapper {
  constructor(private _contract: Contract) {}

  nonceBitmap(nonce: string | number): { wordPos: BigNumber; bitPos: number } {
    let nonceBigNumber: BigNumber;

    try {
      // Handle large nonce values properly
      if (typeof nonce === "string") {
        // If it's already a decimal string, use it directly
        // Remove any trailing decimals if present
        const cleanNonce = nonce.includes(".") ? nonce.split(".")[0] : nonce;
        nonceBigNumber = BigNumber.from(cleanNonce);
      } else {
        nonceBigNumber = BigNumber.from(nonce);
      }
    } catch (error) {
      console.error(`Failed to parse nonce ${nonce}:`, error);
      throw new Error(`Invalid nonce value: ${nonce}`);
    }

    const wordPos = nonceBigNumber.shr(8);
    const bitPos = nonceBigNumber.and(255).toNumber();
    return { wordPos, bitPos };
  }

  async isNonceClaimed(
    owner: string,
    nonce: string | number
  ): Promise<boolean> {
    try {
      const { wordPos, bitPos } = this.nonceBitmap(nonce);

      const startTime = Date.now();
      const bitmap = await this._contract.nonceBitmap(owner, wordPos);
      const duration = Date.now() - startTime;

      if (duration > 5000) {
        console.log(
          `[Permit2] Slow RPC call (${duration}ms) for nonce ${nonce}`
        );
      }

      const bit = BigNumber.from(1).shl(bitPos);
      const flipped = BigNumber.from(bitmap).xor(bit);
      const isClaimed = bit.and(flipped).eq(0);

      return isClaimed;
    } catch (error) {
      console.error(
        `[Permit2] Error checking nonce ${nonce} for owner ${owner}:`,
        error
      );
      throw error;
    }
  }
}
