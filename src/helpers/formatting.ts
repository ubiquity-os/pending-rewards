import { BigNumber } from "ethers";

export interface PermitData {
  nonce: number;
  amount: string;
  partnerAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  network: number;
  userAddress: string;
  userName?: string;
  isClaimed: boolean;
}

export interface WalletTotal {
  wallet: string;
  userName?: string;
  tokenTotals: Record<string, BigNumber>;
  grandTotal: BigNumber;
}

export interface UserWalletTotal {
  wallet: string;
  userName: string;
  tokenTotals: Record<string, BigNumber>;
  grandTotal: BigNumber;
}

export function formatTokenAmount(
  amount: string,
  decimals: number = 18
): BigNumber {
  try {
    return BigNumber.from(amount);
  } catch {
    return BigNumber.from(0);
  }
}

export function calculateWalletTotals(
  permits: PermitData[],
  addressExtractor: (permit: PermitData) => string
): Map<string, WalletTotal> {
  const walletTotals = new Map<string, WalletTotal>();

  for (const permit of permits) {
    const wallet = addressExtractor(permit);
    const tokenKey = `${permit.tokenSymbol} (Network ID: ${permit.network})`;
    const amount = formatTokenAmount(permit.amount);

    if (!walletTotals.has(wallet)) {
      walletTotals.set(wallet, {
        wallet,
        tokenTotals: {},
        grandTotal: BigNumber.from(0),
      });
    }

    const walletData = walletTotals.get(wallet)!;

    if (!walletData.tokenTotals[tokenKey]) {
      walletData.tokenTotals[tokenKey] = BigNumber.from(0);
    }

    walletData.tokenTotals[tokenKey] =
      walletData.tokenTotals[tokenKey].add(amount);
    walletData.grandTotal = walletData.grandTotal.add(amount);
  }

  return walletTotals;
}

export function calculateUserWalletTotals(
  permits: PermitData[]
): Map<string, UserWalletTotal> {
  const walletTotals = new Map<string, UserWalletTotal>();

  for (const permit of permits) {
    const wallet = permit.userAddress;
    const userName = permit.userName || "Unknown User";
    const tokenKey = `${permit.tokenSymbol} (Network ID: ${permit.network})`;
    const amount = formatTokenAmount(permit.amount);

    if (!walletTotals.has(wallet)) {
      walletTotals.set(wallet, {
        wallet,
        userName,
        tokenTotals: {},
        grandTotal: BigNumber.from(0),
      });
    }

    const walletData = walletTotals.get(wallet)!;

    if (!walletData.tokenTotals[tokenKey]) {
      walletData.tokenTotals[tokenKey] = BigNumber.from(0);
    }

    walletData.tokenTotals[tokenKey] =
      walletData.tokenTotals[tokenKey].add(amount);
    walletData.grandTotal = walletData.grandTotal.add(amount);
  }

  return walletTotals;
}

export function getAllUniqueTokens(
  walletTotals: Map<string, WalletTotal>
): string[] {
  const tokens = new Set<string>();

  for (const walletData of walletTotals.values()) {
    for (const tokenKey of Object.keys(walletData.tokenTotals)) {
      tokens.add(tokenKey);
    }
  }

  return Array.from(tokens).sort();
}

export function getAllUniqueTokensFromMaps(
  ...maps: (Map<string, WalletTotal> | Map<string, UserWalletTotal>)[]
): string[] {
  const tokens = new Set<string>();

  for (const map of maps) {
    for (const walletData of map.values()) {
      for (const tokenKey of Object.keys(walletData.tokenTotals)) {
        tokens.add(tokenKey);
      }
    }
  }

  return Array.from(tokens).sort();
}

export function formatBigNumber(
  value: BigNumber,
  decimals: number = 18
): string {
  if (value.isZero()) return "0";

  const divisor = BigNumber.from(10).pow(decimals);
  const wholePart = value.div(divisor);
  const fractionalPart = value.mod(divisor);

  if (fractionalPart.isZero()) {
    return wholePart.toString();
  }

  const fractionalStr = fractionalPart.toString().padStart(decimals, "0");
  const trimmedFractional = fractionalStr.replace(/0+$/, "");

  if (trimmedFractional === "") {
    return wholePart.toString();
  }

  return `${wholePart.toString()}.${trimmedFractional}`;
}

export function padString(str: string, length: number): string {
  return str.padEnd(length, " ");
}

export function formatMarkdownTable(
  headers: string[],
  rows: string[][],
  minColumnWidth: number = 12
): string {
  const columnWidths = headers.map((header, index) => {
    const maxRowWidth = Math.max(
      ...rows.map((row) => (row[index] || "").length)
    );
    return Math.max(header.length, maxRowWidth, minColumnWidth);
  });

  const formatRow = (row: string[]) => {
    return (
      "| " +
      row
        .map((cell, index) => padString(cell || "", columnWidths[index]))
        .join(" | ") +
      " |"
    );
  };

  const separator =
    "|" + columnWidths.map((width) => "-".repeat(width + 2)).join("|") + "|";

  const lines = [
    formatRow(headers),
    separator,
    ...rows.map((row) => formatRow(row)),
  ];

  return lines.join("\n");
}

export function generateWalletTotalsTable(
  title: string,
  walletTotals: Map<string, WalletTotal>,
  uniqueTokens: string[]
): string {
  const headers = ["Wallet", ...uniqueTokens, "Total"];

  const rows = Array.from(walletTotals.values()).map((walletData) => {
    const row = [walletData.wallet];

    for (const token of uniqueTokens) {
      const amount = walletData.tokenTotals[token] || BigNumber.from(0);
      row.push(formatBigNumber(amount));
    }

    row.push(formatBigNumber(walletData.grandTotal));

    return row;
  });

  return `## ${title}\n\n${formatMarkdownTable(headers, rows)}\n`;
}

export function generateUserRewardsTable(
  title: string,
  userTotals: Map<string, UserWalletTotal>,
  uniqueTokens: string[]
): string {
  const headers = ["User Name", "Wallet", ...uniqueTokens, "Total"];

  const rows = Array.from(userTotals.values()).map((userData) => {
    const row = [userData.userName, userData.wallet];

    for (const token of uniqueTokens) {
      const amount = userData.tokenTotals[token] || BigNumber.from(0);
      row.push(formatBigNumber(amount));
    }

    row.push(formatBigNumber(userData.grandTotal));

    return row;
  });

  return `## ${title}\n\n${formatMarkdownTable(headers, rows)}\n`;
}
