export interface AbiInput {
  name: string;
  type: string;
  internalType: string;
  indexed?: boolean;
}

export interface AbiOutput {
  name: string;
  type: string;
  internalType: string;
}

export interface AbiFunction {
  type: "function" | "event" | "constructor" | "error";
  name?: string;
  inputs?: AbiInput[];
  outputs?: AbiOutput[];
  stateMutability?: "pure" | "view" | "nonpayable" | "payable";
  anonymous?: boolean;
}

export type ContractAbi = AbiFunction[];
