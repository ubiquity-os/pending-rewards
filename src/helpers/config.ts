import { Logger } from "./logger";

export function getPartnerAllowlist(
  logger: Logger,
  walletsFromArgs?: string[],
): Set<string> {
  const set = new Set<string>();
  if (walletsFromArgs && walletsFromArgs.length > 0) {
    walletsFromArgs
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v.length > 0)
      .forEach((a) => set.add(a));
  }
  if (set.size === 0) {
    set.add("0x9051eDa96dB419c967189F4Ac303a290F3327680");
    set.add("0x054Ec26398549588F3c958719bD17CC1e6E97c3C");
    logger.info(`Partner allowlist defaulted (${Array.from(set)})`);
  } else {
    logger.info(`Partner allowlist active (${set.size} addresses)`);
  }
  return set;
}
