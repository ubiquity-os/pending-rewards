import { BigNumber, Contract, providers } from "ethers";
import { ContractAbi } from "../types/permit2";

export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

const RPC_URLS: Record<number, string> = {
  1: process.env.RPC_URL_MAINNET || "https://eth.llamarpc.com",
  100: process.env.RPC_URL_GNOSIS || "https://rpc.gnosischain.com",
};

const providerCache = new Map<number, providers.JsonRpcProvider>();
const contractCache = new Map<string, Contract>();

function getProvider(networkId: number): providers.JsonRpcProvider {
  const cached = providerCache.get(networkId);
  if (cached) {
    return cached;
  }

  const rpcUrl = RPC_URLS[networkId];
  if (!rpcUrl) {
    throw new Error(`No RPC URL configured for network ${networkId}`);
  }

  const provider = new providers.JsonRpcProvider(rpcUrl);
  providerCache.set(networkId, provider);
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
      return await this._contract.symbol();
    } catch (error) {
      console.error("Error fetching token symbol:", error);
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
    const nonceBigNumber = BigNumber.from(nonce);
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

      const bitmap = await this._contract.nonceBitmap(owner, wordPos);
      const bit = BigNumber.from(1).shl(bitPos);
      const flipped = BigNumber.from(bitmap).xor(bit);
      const isClaimed = bit.and(flipped).eq(0);

      return isClaimed;
    } catch (error) {
      console.error(`Error checking nonce ${nonce} for owner ${owner}:`, error);
      throw error;
    }
  }
}
