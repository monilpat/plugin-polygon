// src/index.ts
import {
  logger as logger21
} from "@elizaos/core";
import { z as z5 } from "zod";
import { ethers as ethers5 } from "ethers";

// src/actions/transfer.ts
import {
  logger,
  composePromptFromState,
  ModelType
} from "@elizaos/core";
import {
  parseEther
} from "viem";

// src/providers/PolygonWalletProvider.ts
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  formatUnits,
  http,
  publicActions,
  walletActions
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  elizaLogger
} from "@elizaos/core";
import * as viemChains from "viem/chains";
import { PhalaDeriveKeyProvider } from "@elizaos/plugin-tee";
import NodeCache from "node-cache";
var ETH_MAINNET_KEY = "ethereum";
var WalletProvider = class _WalletProvider {
  constructor(accountOrPrivateKey, runtime, chains) {
    this.cacheKey = "polygon/wallet";
    this.currentChain = ETH_MAINNET_KEY;
    this.CACHE_EXPIRY_SEC = 5;
    this.chains = {};
    this.hasChain = (name) => Boolean(this.chains[name]);
    this.setAccount = (accountOrPrivateKey) => {
      if (typeof accountOrPrivateKey === "string") {
        this.account = privateKeyToAccount(accountOrPrivateKey);
      } else {
        this.account = accountOrPrivateKey;
      }
    };
    this.setChains = (chains) => {
      if (!chains) {
        return;
      }
      for (const chain of Object.keys(chains)) {
        this.chains[chain] = chains[chain];
      }
    };
    this.setCurrentChain = (chain) => {
      this.currentChain = chain;
    };
    this.createHttpTransport = (chainName) => {
      const chain = this.chains[chainName];
      if (!chain) {
        throw new Error(
          `Unsupported chain "${chainName}". Available: ${Object.keys(this.chains).join(", ")}`
        );
      }
      if (chain.rpcUrls.custom) {
        return http(chain.rpcUrls.custom.http[0]);
      }
      return http(chain.rpcUrls.default.http[0]);
    };
    this.setAccount(accountOrPrivateKey);
    this.setChains(chains);
    this.runtime = runtime;
    if (chains && Object.keys(chains).length > 0) {
      this.setCurrentChain(Object.keys(chains)[0]);
    }
    this.cache = new NodeCache({ stdTTL: this.CACHE_EXPIRY_SEC });
  }
  getAddress() {
    return this.account.address;
  }
  getCurrentChain() {
    return this.chains[this.currentChain];
  }
  getPublicClient(chainName) {
    const transport = this.createHttpTransport(chainName);
    const publicClient = createPublicClient({
      chain: this.chains[chainName],
      transport
    });
    return publicClient;
  }
  getWalletClient(chainName) {
    const transport = this.createHttpTransport(chainName);
    const walletClient = createWalletClient({
      chain: this.chains[chainName],
      transport,
      account: this.account
    });
    return walletClient;
  }
  getTestClient() {
    return createTestClient({
      chain: viemChains.hardhat,
      mode: "hardhat",
      transport: http()
    }).extend(publicActions).extend(walletActions);
  }
  getChainConfigs(chainName) {
    const key = chainName === ETH_MAINNET_KEY ? "mainnet" : chainName;
    const chain = viemChains[key];
    if (!chain?.id) {
      throw new Error("Invalid chain name");
    }
    return chain;
  }
  async getWalletBalance() {
    try {
      const client = this.getPublicClient(this.currentChain);
      const balance = await client.getBalance({
        address: this.account.address
      });
      const balanceFormatted = formatUnits(balance, 18);
      elizaLogger.log("Wallet balance cached for chain: ", this.currentChain);
      return balanceFormatted;
    } catch (error) {
      console.error("Error getting wallet balance:", error);
      return null;
    }
  }
  async getWalletBalanceForChain(chainName) {
    try {
      const client = this.getPublicClient(chainName);
      const balance = await client.getBalance({
        address: this.account.address
      });
      return formatUnits(balance, 18);
    } catch (error) {
      console.error("Error getting wallet balance:", error);
      return null;
    }
  }
  addChain(chain) {
    this.setChains(chain);
  }
  getActiveWalletClient() {
    return this.getWalletClient(this.currentChain);
  }
  switchChain(chainName, customRpcUrl) {
    if (!this.chains[chainName]) {
      const chain = _WalletProvider.genChainFromName(chainName, customRpcUrl);
      this.addChain({ [chainName]: chain });
    }
    this.setCurrentChain(chainName);
  }
  async switchChainById(chainId) {
    const entry = Object.entries(this.chains).find(([, c]) => c.id === chainId);
    if (!entry) throw new Error(`Unsupported chainId ${chainId}`);
    const [name] = entry;
    this.setCurrentChain(name);
    return this.getActiveWalletClient();
  }
  static genChainFromName(chainName, customRpcUrl) {
    const baseChain = viemChains[chainName];
    if (!baseChain?.id) {
      throw new Error("Invalid chain name");
    }
    const viemChain = customRpcUrl ? {
      ...baseChain,
      rpcUrls: {
        ...baseChain.rpcUrls,
        custom: {
          http: [customRpcUrl]
        }
      }
    } : baseChain;
    return viemChain;
  }
};
var genChainsFromRuntime = (runtime) => {
  const chains = {};
  const polygonRpcUrl = runtime.getSetting("POLYGON_RPC_URL");
  if (polygonRpcUrl) {
    const isMainnet = !/mumbai/i.test(polygonRpcUrl);
    const polygonChainName = isMainnet ? "polygon" : "polygonMumbai";
    try {
      const chain = WalletProvider.genChainFromName(polygonChainName, polygonRpcUrl);
      chains[polygonChainName] = chain;
      elizaLogger.info(`Configured Polygon chain: ${polygonChainName}`);
    } catch (error) {
      elizaLogger.error(`Error configuring Polygon chain (${polygonChainName}):`, error);
    }
  } else {
    elizaLogger.warn("POLYGON_RPC_URL setting not found.");
  }
  const ethRpcUrl = runtime.getSetting("ETHEREUM_RPC_URL");
  if (ethRpcUrl) {
    const isEthMainnet = !/(sepolia|goerli|ropsten|kovan)/i.test(ethRpcUrl);
    const viemKeyForEth = isEthMainnet ? "mainnet" : "sepolia";
    const storageKeyForEth = isEthMainnet ? ETH_MAINNET_KEY : "sepolia";
    try {
      const chain = WalletProvider.genChainFromName(viemKeyForEth, ethRpcUrl);
      chains[storageKeyForEth] = chain;
      elizaLogger.info(
        `Configured Ethereum L1 chain: ${storageKeyForEth} (using viem key: ${viemKeyForEth})`
      );
    } catch (error) {
      elizaLogger.error(
        `Error configuring Ethereum L1 chain (${storageKeyForEth} with viem key ${viemKeyForEth}):`,
        error
      );
    }
  } else {
    elizaLogger.warn("ETHEREUM_RPC_URL setting not found.");
  }
  if (Object.keys(chains).length === 0) {
    elizaLogger.error("No chains could be configured. WalletProvider may not function correctly.");
  }
  return chains;
};
var initWalletProvider = async (runtime) => {
  const teeMode = runtime.getSetting("TEE_MODE") || "OFF";
  const chains = genChainsFromRuntime(runtime);
  if (Object.keys(chains).length === 0) {
    elizaLogger.error("Cannot initialize WalletProvider: No chains configured.");
    return null;
  }
  if (teeMode !== "OFF") {
    const walletSecretSalt = runtime.getSetting("WALLET_SECRET_SALT");
    if (!walletSecretSalt) {
      throw new Error("WALLET_SECRET_SALT required when TEE_MODE is enabled");
    }
    try {
      const deriveKeyProvider = new PhalaDeriveKeyProvider(teeMode);
      const deriveKeyResult = await deriveKeyProvider.deriveEcdsaKeypair(
        walletSecretSalt,
        "polygon",
        // Use a unique context for polygon
        runtime.agentId
      );
      elizaLogger.info("Initialized WalletProvider using TEE derived key.");
      return new WalletProvider(
        deriveKeyResult.keypair,
        runtime,
        chains
      );
    } catch (error) {
      elizaLogger.error("Failed to initialize WalletProvider with TEE:", error);
      throw error;
    }
  } else {
    const rawPrivateKey = runtime.getSetting("PRIVATE_KEY");
    elizaLogger.info("PRIVATE_KEY setting retrieved (not showing actual key for security)");
    if (!rawPrivateKey) {
      elizaLogger.error(
        "PRIVATE_KEY setting is missing or not loaded. Cannot initialize WalletProvider."
      );
      throw new Error("PRIVATE_KEY setting is missing for WalletProvider initialization");
    }
    try {
      const privateKey = rawPrivateKey.startsWith("0x") ? rawPrivateKey : `0x${rawPrivateKey}`;
      const provider = new WalletProvider(privateKey, runtime, chains);
      elizaLogger.info("Initialized WalletProvider using PRIVATE_KEY setting.");
      return provider;
    } catch (error) {
      elizaLogger.error("Failed to initialize WalletProvider with private key:", error);
      throw error;
    }
  }
};
async function directFetchWalletData(runtime, state) {
  try {
    const walletProvider = await initWalletProvider(runtime);
    if (!walletProvider) {
      throw new Error("Failed to initialize wallet provider");
    }
    const address = walletProvider.getAddress();
    const chainBalances = {};
    for (const chainName of Object.keys(walletProvider.chains)) {
      try {
        const balance = await walletProvider.getWalletBalanceForChain(chainName);
        if (balance) {
          chainBalances[chainName] = balance;
        }
      } catch (error) {
        elizaLogger.error(`Error getting balance for chain ${chainName}:`, error);
      }
    }
    const agentName = state?.agentName || "The agent";
    const chainDetails = Object.entries(chainBalances).map(([chainName, balance]) => {
      const chain = walletProvider.chains[chainName];
      return {
        chainName,
        balance,
        symbol: chain.nativeCurrency.symbol,
        chainId: chain.id,
        name: chain.name
      };
    });
    const balanceText = chainDetails.map((chain) => `${chain.name}: ${chain.balance} ${chain.symbol}`).join("\n");
    return {
      text: `${agentName}'s Polygon Wallet Address: ${address}

Balances:
${balanceText}`,
      data: {
        address,
        chains: chainDetails
      },
      values: {
        address,
        chains: JSON.stringify(chainDetails)
      }
    };
  } catch (error) {
    elizaLogger.error("Error fetching wallet data directly:", error);
    return {
      text: `Error getting Polygon wallet provider: ${error instanceof Error ? error.message : String(error)}`,
      data: { error: error instanceof Error ? error.message : String(error) },
      values: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}
var polygonWalletProvider = {
  name: "PolygonWalletProvider",
  async get(runtime, _message, state) {
    try {
      return await directFetchWalletData(runtime, state);
    } catch (error) {
      elizaLogger.error("Error in Polygon wallet provider:", error);
      const errorText = error instanceof Error ? error.message : String(error);
      return {
        text: `Error in Polygon wallet provider: ${errorText}`,
        data: { error: errorText },
        values: { error: errorText }
      };
    }
  }
};

// src/actions/transfer.ts
var transferTemplateObj = {
  name: "Transfer MATIC or Tokens",
  description: "Generates parameters to transfer MATIC (native currency) or execute a token transaction. // Respond with a valid JSON object containing the extracted parameters.",
  parameters: {
    type: "object",
    properties: {
      fromChain: {
        type: "string",
        description: "Blockchain name (e.g., polygon). Default: polygon.",
        default: "polygon"
      },
      toAddress: { type: "string", description: "Recipient address." },
      amount: {
        type: "string",
        description: 'Amount of MATIC (native) to transfer. For ERC20, use "0" if value is in data.'
      },
      data: {
        type: "string",
        description: "Optional: Hex data for transaction (e.g., ERC20 transfer calldata)."
      },
      tokenAddress: { type: "string", description: "Optional: ERC20 token contract address." }
    },
    required: ["toAddress", "amount"]
  }
};
var PolygonTransferActionRunner = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  // Use imported WalletProvider
  async transfer(params) {
    const effectiveChain = (params.fromChain || "polygon").toLowerCase();
    const walletClient = this.walletProvider.getWalletClient(effectiveChain);
    const publicClient = this.walletProvider.getPublicClient(effectiveChain);
    const chainConfig = this.walletProvider.getChainConfigs(effectiveChain);
    const [fromAddress] = await walletClient.getAddresses();
    let txTo = params.toAddress;
    let txData = params.data === "0x" ? void 0 : params.data;
    let txValue = parseEther(params.amount);
    if (params.tokenAddress) {
      txTo = params.tokenAddress;
      if (!txData) {
        logger.warn(
          `ERC20 tokenAddress ${params.tokenAddress} provided, but no txData. This action will likely fail or do something unintended unless the LLM provides specific calldata for this token interaction.`
        );
      } else {
        logger.info(
          `ERC20 interaction with token ${txTo}, data: ${txData}. Value field ${params.amount} ETH will be sent with this call.`
        );
      }
    } else if (txData) {
      logger.info(
        `Raw transaction with data ${txData} to ${params.toAddress}. Value: ${params.amount} ETH.`
      );
    } else {
      logger.info(
        `Native transfer: ${params.amount} ETH to ${params.toAddress} on ${effectiveChain}.`
      );
    }
    try {
      const kzg = {
        blobToKzgCommitment: (_blob) => {
          throw new Error("KZG not impl.");
        },
        computeBlobKzgProof: (_blob, _commit) => {
          throw new Error("KZG not impl.");
        }
      };
      const hash = await walletClient.sendTransaction({
        account: fromAddress,
        to: txTo,
        value: txValue,
        data: txData,
        chain: chainConfig,
        kzg
      });
      logger.info(`Transaction sent: ${hash}. Waiting for receipt...`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return {
        hash,
        from: fromAddress,
        to: txTo,
        value: txValue,
        data: txData,
        chainId: chainConfig.id,
        logs: receipt.logs
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Transfer failed: ${errMsg}`, error);
      throw new Error(`Transfer failed: ${errMsg}`);
    }
  }
};
var transferPolygonAction = {
  name: "TRANSFER_POLYGON",
  similes: ["POLYGON_SEND", "TRANSFER_MATIC_OR_TOKEN_POLYGON"],
  description: "Transfers MATIC (native currency) or executes a token transaction on Polygon.",
  validate: async (runtime, _m, _s) => {
    logger.debug("Validating TRANSFER_POLYGON action...");
    const checks = [
      runtime.getSetting("WALLET_PRIVATE_KEY"),
      runtime.getSetting("POLYGON_PLUGINS_ENABLED")
    ];
    if (checks.some((check) => !check)) {
      logger.error(
        "Required settings (WALLET_PRIVATE_KEY, POLYGON_PLUGINS_ENABLED) are not configured."
      );
      return false;
    }
    try {
      await initWalletProvider(runtime);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error(`WalletProvider initialization failed during validation: ${errMsg}`);
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _responses) => {
    logger.info("Handling TRANSFER_POLYGON for message:", message.id);
    try {
      const walletProvider = await initWalletProvider(runtime);
      const actionRunner = new PolygonTransferActionRunner(walletProvider);
      const supportedChains = Object.keys(walletProvider.chains).map((c) => `"${c}"`).join(" | ");
      const dynamicTransferTemplate = {
        ...transferTemplateObj,
        parameters: {
          ...transferTemplateObj.parameters,
          properties: {
            ...transferTemplateObj.parameters.properties,
            fromChain: {
              type: "string",
              description: `The blockchain name (e.g., polygon). Supported: ${supportedChains}. Default is polygon.`,
              default: "polygon"
            }
          }
        }
      };
      const prompt = composePromptFromState({
        state,
        template: dynamicTransferTemplate
      });
      const modelResponse = await runtime.useModel(ModelType.SMALL, { prompt });
      let paramsJson;
      try {
        const jsonString = (modelResponse || "").replace(/^```json(\r?\n)?|(\r?\n)?```$/g, "");
        paramsJson = JSON.parse(jsonString);
      } catch (e) {
        logger.error("Failed to parse LLM response for transfer params:", modelResponse, e);
        throw new Error("Could not understand transfer parameters.");
      }
      if (!paramsJson.toAddress || typeof paramsJson.amount === "undefined") {
        throw new Error("Incomplete transfer parameters: toAddress and amount are required.");
      }
      const transferParams = {
        fromChain: (paramsJson.fromChain || "polygon").toLowerCase(),
        toAddress: paramsJson.toAddress,
        amount: paramsJson.amount,
        data: paramsJson.data,
        tokenAddress: paramsJson.tokenAddress
      };
      logger.debug("Parsed transfer parameters:", transferParams);
      const txResult = await actionRunner.transfer(transferParams);
      const successMsg = `Successfully transferred ${transferParams.amount} ${transferParams.tokenAddress ? `token ${transferParams.tokenAddress}` : "native currency"} to ${transferParams.toAddress} on ${transferParams.fromChain}. TxHash: ${txResult.hash}`;
      logger.info(successMsg);
      if (callback) {
        await callback({
          text: successMsg,
          content: { success: true, ...txResult, chain: transferParams.fromChain },
          actions: ["TRANSFER_POLYGON"],
          source: message.content.source
        });
      }
      return { success: true, ...txResult, chain: transferParams.fromChain };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error("Error in TRANSFER_POLYGON handler:", errMsg, error);
      if (callback) {
        await callback({
          text: `Error transferring assets: ${errMsg}`,
          actions: ["TRANSFER_POLYGON"],
          source: message.content.source
        });
      }
      return { success: false, error: errMsg };
    }
  },
  examples: [
    [
      {
        name: "Transfer MATIC",
        content: { text: "Send 10.5 MATIC to 0xRecipientAddress on Polygon." }
      }
    ],
    [
      {
        name: "Transfer USDC",
        content: {
          text: "Transfer 100 USDC (0xTokenAddress) to 0xRecipient on Polygon. Calldata: 0xData."
        }
      }
    ]
  ]
};

// src/actions/delegateL1.ts
import {
  logger as logger3,
  ModelType as ModelType2,
  composePromptFromState as composePromptFromState2,
  parseJSONObjectFromText
} from "@elizaos/core";
import { ethers as ethers2, parseUnits as parseUnits2 } from "ethers";

// src/services/PolygonRpcService.ts
import { Service, logger as logger2 } from "@elizaos/core";
import {
  ethers,
  JsonRpcProvider,
  Wallet,
  Contract,
  ZeroAddress,
  MaxUint256
} from "ethers";

// src/contracts/StakeManagerABI.json
var StakeManagerABI_default = [
  {
    inputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    constant: false,
    inputs: [
      {
        name: "_registry",
        type: "address"
      },
      {
        name: "_rootchain",
        type: "address"
      },
      {
        name: "_token",
        type: "address"
      },
      {
        name: "_NFTContract",
        type: "address"
      },
      {
        name: "_stakingLogger",
        type: "address"
      },
      {
        name: "_validatorShareFactory",
        type: "address"
      },
      {
        name: "_governance",
        type: "address"
      },
      {
        name: "_owner",
        type: "address"
      },
      {
        name: "_extensionCode",
        type: "address"
      }
    ],
    name: "initialize",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "isOwner",
    outputs: [
      {
        name: "",
        type: "bool"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "getRegistry",
    outputs: [
      {
        name: "",
        type: "address"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        name: "tokenId",
        type: "uint256"
      }
    ],
    name: "ownerOf",
    outputs: [
      {
        name: "",
        type: "address"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "epoch",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "withdrawalDelay",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "validatorStake",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        name: "user",
        type: "address"
      }
    ],
    name: "getValidatorId",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "delegatedAmount",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "delegatorsReward",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "validatorReward",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "currentValidatorSetSize",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "currentValidatorSetTotalStake",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "getValidatorContract",
    outputs: [
      {
        name: "",
        type: "address"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "isValidator",
    outputs: [
      {
        name: "",
        type: "bool"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "enabled",
        type: "bool"
      }
    ],
    name: "setDelegationEnabled",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "forceUnstake",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "_currentEpoch",
        type: "uint256"
      }
    ],
    name: "setCurrentEpoch",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "_token",
        type: "address"
      }
    ],
    name: "setStakingToken",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "newThreshold",
        type: "uint256"
      }
    ],
    name: "updateValidatorThreshold",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "_blocks",
        type: "uint256"
      }
    ],
    name: "updateCheckPointBlockInterval",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "newReward",
        type: "uint256"
      }
    ],
    name: "updateCheckpointReward",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "user",
        type: "address"
      },
      {
        name: "heimdallFee",
        type: "uint256"
      }
    ],
    name: "topUpForFee",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "user",
        type: "address"
      },
      {
        name: "amount",
        type: "uint256"
      },
      {
        name: "heimdallFee",
        type: "uint256"
      },
      {
        name: "acceptDelegation",
        type: "bool"
      },
      {
        name: "signerPubkey",
        type: "bytes"
      }
    ],
    name: "stakeFor",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "unstake",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "unstakeClaim",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      },
      {
        name: "amount",
        type: "uint256"
      },
      {
        name: "stakeRewards",
        type: "bool"
      }
    ],
    name: "restake",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "withdrawRewards",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "fromValidatorId",
        type: "uint256"
      },
      {
        name: "toValidatorId",
        type: "uint256"
      },
      {
        name: "amount",
        type: "uint256"
      }
    ],
    name: "migrateDelegation",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      },
      {
        name: "amount",
        type: "int256"
      }
    ],
    name: "updateValidatorState",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      },
      {
        name: "amount",
        type: "uint256"
      }
    ],
    name: "decreaseValidatorDelegatedAmount",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      },
      {
        name: "signerPubkey",
        type: "bytes"
      }
    ],
    name: "updateSigner",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "blockInterval",
        type: "uint256"
      },
      {
        name: "voteHash",
        type: "bytes32"
      },
      {
        name: "stateRoot",
        type: "bytes32"
      },
      {
        name: "proposer",
        type: "address"
      },
      {
        name: "sigs",
        type: "uint256[3][]"
      }
    ],
    name: "checkSignatures",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      },
      {
        name: "newCommissionRate",
        type: "uint256"
      }
    ],
    name: "updateCommissionRate",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "_slashingInfoList",
        type: "bytes"
      }
    ],
    name: "slash",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "validatorId",
        type: "uint256"
      }
    ],
    name: "unjail",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  }
];

// src/contracts/ValidatorShareABI.json
var ValidatorShareABI_default = [
  {
    inputs: [],
    name: "buyVoucher",
    outputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "_minSharesToMint",
        type: "uint256"
      }
    ],
    name: "buyVoucher",
    outputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [],
    name: "restake",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_unbondNonce",
        type: "uint256"
      }
    ],
    name: "unstakeClaimTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "claimAmount",
        type: "uint256"
      }
    ],
    name: "unstakeClaimTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "sellVoucher",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "_minClaimAmount",
        type: "uint256"
      }
    ],
    name: "sellVoucher",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "withdrawRewards",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address"
      }
    ],
    name: "getLiquidRewards",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address"
      }
    ],
    name: "getTotalStake",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "validatorId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "activeAmount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "amountStaked",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "exchangeRate",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    name: "unbonds",
    outputs: [
      {
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "withdrawEpoch",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "ShareMinted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "ShareBurned",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "RewardClaimed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "nonce",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "claimAmount",
        type: "uint256"
      }
    ],
    name: "Unbonded",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "nonce",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "UnbondClaimed",
    type: "event"
  }
];

// src/contracts/RootChainManagerABI.json
var RootChainManagerABI_default = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "tokenType",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "predicateAddress",
        type: "address"
      }
    ],
    name: "PredicateRegistered",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "rootToken",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "childToken",
        type: "address"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "tokenType",
        type: "bytes32"
      }
    ],
    name: "TokenMapped",
    type: "event"
  },
  {
    inputs: [],
    name: "DEPOSIT",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "ETHER_ADDRESS",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "MAP_TOKEN",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "MAPPER_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "checkpointManagerAddress",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "childChainManagerAddress",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "rootToken",
        type: "address"
      },
      {
        internalType: "address",
        name: "childToken",
        type: "address"
      }
    ],
    name: "cleanMapToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address"
      },
      {
        internalType: "address",
        name: "rootToken",
        type: "address"
      },
      {
        internalType: "bytes",
        name: "depositData",
        type: "bytes"
      }
    ],
    name: "depositFor",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address"
      }
    ],
    name: "depositEtherFor",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "inputData",
        type: "bytes"
      }
    ],
    name: "exit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_owner",
        type: "address"
      }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "initializeEIP712",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "rootToken",
        type: "address"
      },
      {
        internalType: "address",
        name: "childToken",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "tokenType",
        type: "bytes32"
      }
    ],
    name: "mapToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    name: "processedExits",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "tokenType",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "predicateAddress",
        type: "address"
      }
    ],
    name: "registerPredicate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "rootToken",
        type: "address"
      },
      {
        internalType: "address",
        name: "childToken",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "tokenType",
        type: "bytes32"
      }
    ],
    name: "remapToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newCheckpointManager",
        type: "address"
      }
    ],
    name: "setCheckpointManager",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newChildChainManager",
        type: "address"
      }
    ],
    name: "setChildChainManagerAddress",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newStateSender",
        type: "address"
      }
    ],
    name: "setStateSender",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "setupContractId",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "stateSenderAddress",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    stateMutability: "payable",
    type: "receive"
  }
];

// src/contracts/ERC20ABI.json
var ERC20ABI_default = [
  {
    constant: true,
    inputs: [],
    name: "name",
    outputs: [
      {
        name: "",
        type: "string"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [
      {
        name: "",
        type: "uint8"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "symbol",
    outputs: [
      {
        name: "",
        type: "string"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        name: "_owner",
        type: "address"
      },
      {
        name: "_spender",
        type: "address"
      }
    ],
    name: "allowance",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "_spender",
        type: "address"
      },
      {
        name: "_value",
        type: "uint256"
      }
    ],
    name: "approve",
    outputs: [
      {
        name: "",
        type: "bool"
      }
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "totalSupply",
    outputs: [
      {
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "_from",
        type: "address"
      },
      {
        name: "_to",
        type: "address"
      },
      {
        name: "_value",
        type: "uint256"
      }
    ],
    name: "transferFrom",
    outputs: [
      {
        name: "",
        type: "bool"
      }
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        name: "_owner",
        type: "address"
      }
    ],
    name: "balanceOf",
    outputs: [
      {
        name: "balance",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        name: "_to",
        type: "address"
      },
      {
        name: "_value",
        type: "uint256"
      }
    ],
    name: "transfer",
    outputs: [
      {
        name: "",
        type: "bool"
      }
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    payable: true,
    stateMutability: "payable",
    type: "fallback"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: "owner",
        type: "address"
      },
      {
        indexed: true,
        name: "spender",
        type: "address"
      },
      {
        indexed: false,
        name: "value",
        type: "uint256"
      }
    ],
    name: "Approval",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        name: "value",
        type: "uint256"
      }
    ],
    name: "Transfer",
    type: "event"
  }
];

// src/contracts/CheckpointManagerABI.json
var CheckpointManagerABI_default = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "proposer",
        type: "address"
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "headerBlockId",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "reward",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "start",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "end",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "root",
        type: "bytes32"
      }
    ],
    name: "NewHeaderBlock",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "proposer",
        type: "address"
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "headerBlockId",
        type: "uint256"
      }
    ],
    name: "ResetHeaderBlock",
    type: "event"
  },
  {
    constant: true,
    inputs: [],
    name: "CHAINID",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "VOTE_TYPE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "_nextHeaderBlock",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "currentHeaderBlock",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "getLastChildBlock",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    name: "headerBlocks",
    outputs: [
      {
        internalType: "bytes32",
        name: "root",
        type: "bytes32"
      },
      {
        internalType: "uint256",
        name: "start",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "end",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "createdAt",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "proposer",
        type: "address"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "heimdallId",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "isOwner",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "networkId",
    outputs: [
      {
        internalType: "bytes",
        name: "",
        type: "bytes"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    payable: false,
    stateMutability: "view",
    type: "function"
  },
  {
    constant: false,
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        internalType: "string",
        name: "_heimdallId",
        type: "string"
      }
    ],
    name: "setHeimdallId",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        internalType: "uint256",
        name: "_value",
        type: "uint256"
      }
    ],
    name: "setNextHeaderBlock",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [],
    name: "slash",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        internalType: "bytes",
        name: "data",
        type: "bytes"
      },
      {
        internalType: "uint256[3][]",
        name: "sigs",
        type: "uint256[3][]"
      }
    ],
    name: "submitCheckpoint",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        internalType: "bytes",
        name: "data",
        type: "bytes"
      },
      {
        internalType: "bytes",
        name: "sigs",
        type: "bytes"
      }
    ],
    name: "submitHeaderBlock",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "transferOwnership",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    constant: false,
    inputs: [
      {
        internalType: "uint256",
        name: "numDeposits",
        type: "uint256"
      }
    ],
    name: "updateDepositId",
    outputs: [
      {
        internalType: "uint256",
        name: "depositId",
        type: "uint256"
      }
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "function"
  }
];

// src/services/GasService.ts
import axios from "axios";
import { parseUnits } from "ethers";
import { elizaLogger as elizaLogger2 } from "@elizaos/core";
var coreRpc = {
  eth_gasPrice: async () => {
    elizaLogger2.warn("Using fallback eth_gasPrice RPC method.");
    return parseUnits("50", "gwei");
  }
};
var POLYGONSCAN_API_URL = "https://api.polygonscan.com/api";
function gweiToWei(gweiString) {
  try {
    return parseUnits(gweiString, "gwei");
  } catch (error) {
    elizaLogger2.error(`Error converting Gwei string "${gweiString}" to Wei:`, error);
    throw new Error(`Invalid Gwei value format: ${gweiString}`);
  }
}
var getGasPriceEstimates = async (runtime) => {
  const apiKey = runtime.getSetting("POLYGONSCAN_KEY");
  if (!apiKey) {
    elizaLogger2.warn("POLYGONSCAN_KEY not found in configuration. Falling back to eth_gasPrice.");
    return fetchFallbackGasPrice();
  }
  const params = {
    module: "gastracker",
    action: "gasoracle",
    apikey: apiKey
  };
  try {
    const response = await axios.get(POLYGONSCAN_API_URL, { params });
    if (response.status !== 200) {
      throw new Error(`PolygonScan API request failed with status ${response.status}`);
    }
    const data = response.data;
    if (data.status !== "1" || !data.result) {
      elizaLogger2.error(
        `PolygonScan API returned an error: ${data.message} (Status: ${data.status})`
      );
      elizaLogger2.warn("Falling back to eth_gasPrice.");
      return fetchFallbackGasPrice();
    }
    const { SafeGasPrice, ProposeGasPrice, FastGasPrice, suggestBaseFee } = data.result;
    const safeWei = gweiToWei(SafeGasPrice);
    const proposeWei = gweiToWei(ProposeGasPrice);
    const fastWei = gweiToWei(FastGasPrice);
    const baseFeeWei = gweiToWei(suggestBaseFee);
    return {
      safeLow: { maxPriorityFeePerGas: safeWei },
      average: { maxPriorityFeePerGas: proposeWei },
      fast: { maxPriorityFeePerGas: fastWei },
      estimatedBaseFee: baseFeeWei,
      fallbackGasPrice: null
      // Indicate fallback was not used
    };
  } catch (error) {
    elizaLogger2.error("Error fetching or parsing PolygonScan gas estimates:", error);
    elizaLogger2.warn("Falling back to eth_gasPrice.");
    return fetchFallbackGasPrice();
  }
};
var fetchFallbackGasPrice = async () => {
  try {
    const gasPriceWei = await coreRpc.eth_gasPrice();
    return {
      safeLow: null,
      average: null,
      // Or potentially { maxPriorityFeePerGas: gasPriceWei } if treating as priority
      fast: null,
      estimatedBaseFee: null,
      fallbackGasPrice: gasPriceWei
      // Provide the fallback value explicitly
    };
  } catch (rpcError) {
    elizaLogger2.error("Error fetching fallback gas price via eth_gasPrice:", rpcError);
    return {
      safeLow: null,
      average: null,
      fast: null,
      estimatedBaseFee: null,
      fallbackGasPrice: null
    };
  }
};

// src/services/PolygonRpcService.ts
var STAKE_MANAGER_ADDRESS_L1 = "0x5e3Ef299fDDf15eAa0432E6e66473ace8c13D908";
var ROOT_CHAIN_MANAGER_ADDRESS_L1 = "0xA0c68C638235ee32657e8f720a23ceC1bFc77C77";
var _PolygonRpcService = class _PolygonRpcService extends Service {
  // Added RootChainManager instance
  constructor(runtime) {
    super();
    this.capabilityDescription = "Provides access to Ethereum (L1) and Polygon (L2) JSON-RPC nodes and L1 staking operations.";
    this.l1Provider = null;
    this.l2Provider = null;
    this.l1Signer = null;
    // Added L1 Signer
    this.stakeManagerContractL1 = null;
    // Added for L1 StakeManager
    this.rootChainManagerContractL1 = null;
    this.runtime = runtime;
  }
  async initializeProviders() {
    if (this.l1Provider && this.l2Provider && this.rootChainManagerContractL1) {
      return;
    }
    if (!this.runtime) {
      throw new Error("Runtime required");
    }
    const l1RpcUrl = this.runtime.getSetting("ETHEREUM_RPC_URL");
    const l2RpcUrl = this.runtime.getSetting("POLYGON_RPC_URL");
    const privateKey = this.runtime.getSetting("PRIVATE_KEY");
    if (!l1RpcUrl || !l2RpcUrl) {
      throw new Error("Missing L1/L2 RPC URLs");
    }
    if (!privateKey) {
      throw new Error("Missing PRIVATE_KEY for signer initialization");
    }
    try {
      this.l1Provider = new JsonRpcProvider(l1RpcUrl);
      this.l2Provider = new JsonRpcProvider(l2RpcUrl);
      this.l1Signer = new Wallet(privateKey, this.l1Provider);
      logger2.info("PolygonRpcService initialized L1/L2 providers and L1 signer.");
      this.stakeManagerContractL1 = new Contract(
        STAKE_MANAGER_ADDRESS_L1,
        StakeManagerABI_default,
        this.l1Provider
      );
      await this.stakeManagerContractL1.epoch();
      logger2.info("StakeManager L1 contract instance created and connection verified.");
      this.rootChainManagerContractL1 = new Contract(
        ROOT_CHAIN_MANAGER_ADDRESS_L1,
        RootChainManagerABI_default,
        this.l1Signer
        // Use signer for sending transactions
      );
      logger2.info("RootChainManager L1 contract instance created.");
      logger2.debug("RootChainManager contract details:", {
        address: ROOT_CHAIN_MANAGER_ADDRESS_L1,
        methods: this.rootChainManagerContractL1.interface.fragments.map((f) => typeof f === "object" && f.name ? f.name : "unnamed").join(", ")
      });
    } catch (error) {
      logger2.error("Failed during PolygonRpcService initialization:", error);
      this.l1Provider = null;
      this.l2Provider = null;
      this.l1Signer = null;
      this.stakeManagerContractL1 = null;
      this.rootChainManagerContractL1 = null;
      throw new Error("Failed to initialize PolygonRpcService components");
    }
  }
  static async start(runtime) {
    logger2.info("Starting PolygonRpcService...");
    const service = new _PolygonRpcService(runtime);
    await service.initializeProviders();
    return service;
  }
  static async stop(runtime) {
    logger2.info("Stopping PolygonRpcService...");
    const service = runtime.getService(_PolygonRpcService.serviceType);
    if (service) {
      await service.stop();
    }
  }
  async stop() {
    logger2.info("PolygonRpcService instance stopped.");
    this.l1Provider = null;
    this.l2Provider = null;
    this.l1Signer = null;
    this.stakeManagerContractL1 = null;
    this.rootChainManagerContractL1 = null;
  }
  getProvider(network) {
    const provider = network === "L1" ? this.l1Provider : this.l2Provider;
    if (!provider) {
      throw new Error(`Provider ${network} not initialized.`);
    }
    return provider;
  }
  // Get L1 Signer (ensure initialized)
  getL1Signer() {
    if (!this.l1Signer) {
      throw new Error("L1 Signer is not initialized.");
    }
    return this.l1Signer;
  }
  // Helper to get initialized StakeManager contract
  getStakeManagerContract() {
    if (!this.stakeManagerContractL1) {
      throw new Error("StakeManager L1 contract is not initialized.");
    }
    return this.stakeManagerContractL1;
  }
  // Helper to get initialized RootChainManager contract
  getRootChainManagerContract() {
    if (!this.rootChainManagerContractL1) {
      throw new Error("RootChainManager L1 contract is not initialized.");
    }
    return this.rootChainManagerContractL1;
  }
  // --- Helper: Get Signer-Aware ValidatorShare Contract ---
  async _getValidatorShareContract(validatorId) {
    const stakeManager = this.getStakeManagerContract();
    const signer = this.getL1Signer();
    logger2.debug(`Fetching ValidatorShare contract address for validator ${validatorId}...`);
    const validatorShareAddress = await stakeManager.getValidatorContract(validatorId);
    if (!validatorShareAddress || validatorShareAddress === ZeroAddress) {
      logger2.error(
        `ValidatorShare contract address not found or zero for validator ID ${validatorId}.`
      );
      throw new Error(`Validator ${validatorId} does not have a valid ValidatorShare contract.`);
    }
    logger2.debug(`Found ValidatorShare address: ${validatorShareAddress}`);
    const validatorShareContract = new Contract(validatorShareAddress, ValidatorShareABI_default, signer);
    try {
      if (!validatorShareContract.interface.getFunction("buyVoucher(uint256,uint256)")) {
        logger2.warn(
          `ValidatorShare contract at ${validatorShareAddress} may not have expected interface - buyVoucher(uint256,uint256) not found.`
        );
      }
    } catch (error) {
      logger2.warn(
        `Could not verify ValidatorShare contract interface: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return validatorShareContract;
  }
  // --- Core EVM Wrappers --- (remain the same)
  async getBlockNumber(network) {
    try {
      const provider = this.getProvider(network);
      return await provider.getBlockNumber();
    } catch (error) {
      logger2.error(`Error in getBlockNumber (${network}):`, error);
      throw error;
    }
  }
  async getBalance(address, network) {
    try {
      const provider = this.getProvider(network);
      return await provider.getBalance(address);
    } catch (error) {
      logger2.error(`Error in getBalance (${network}) for ${address}:`, error);
      throw error;
    }
  }
  async getTransaction(txHash, network) {
    try {
      const provider = this.getProvider(network);
      return await provider.getTransaction(txHash);
    } catch (error) {
      logger2.error(`Error in getTransaction (${network}) for ${txHash}:`, error);
      throw error;
    }
  }
  async getTransactionReceipt(txHash, network) {
    try {
      const provider = this.getProvider(network);
      return await provider.getTransactionReceipt(txHash);
    } catch (error) {
      logger2.error(`Error in getTransactionReceipt (${network}) for ${txHash}:`, error);
      throw error;
    }
  }
  async getBlock(blockIdentifier, network) {
    try {
      const provider = this.getProvider(network);
      return await provider.getBlock(blockIdentifier);
    } catch (error) {
      logger2.error(`Error in getBlock (${network}) for ${blockIdentifier}:`, error);
      throw error;
    }
  }
  async call(transaction, network) {
    try {
      const provider = this.getProvider(network);
      return await provider.call(transaction);
    } catch (error) {
      logger2.error(`Error in call (${network}):`, error);
      throw error;
    }
  }
  async sendRawTransaction(signedTx, network) {
    try {
      const provider = this.getProvider(network);
      return await provider.broadcastTransaction(signedTx);
    } catch (error) {
      logger2.error(`Error in sendRawTransaction (${network}):`, error);
      throw error;
    }
  }
  // --- Polygon L2 Specific Read Functions --- (Existing methods remain unchanged)
  async getCurrentBlockNumber() {
    logger2.debug("Getting current L2 block number...");
    return this.getBlockNumber("L2");
  }
  async getBlockDetails(identifier) {
    logger2.debug(`Getting L2 block details for: ${identifier}`);
    return this.getBlock(identifier, "L2");
  }
  /**
   * Gets transaction details and receipt for a given hash on Polygon (L2).
   * @param txHash Transaction hash.
   * @returns An object containing the transaction response and receipt, or null if not found.
   */
  async getTransactionDetails(txHash) {
    logger2.debug(`Getting L2 transaction details for: ${txHash}`);
    try {
      const [transaction, receipt] = await Promise.all([
        this.getTransaction(txHash, "L2"),
        this.getTransactionReceipt(txHash, "L2")
      ]);
      if (!transaction && !receipt) {
        return null;
      }
      return { transaction, receipt };
    } catch (error) {
      logger2.error(`Failed to get full transaction details for ${txHash} on L2.`);
      throw error;
    }
  }
  async getNativeBalance(address) {
    logger2.debug(`Getting native L2 balance for: ${address}`);
    return this.getBalance(address, "L2");
  }
  async getErc20Balance(tokenAddress, accountAddress) {
    logger2.debug(
      `Getting ERC20 balance for token ${tokenAddress} on account ${accountAddress} on L2...`
    );
    try {
      const l2Provider = this.getProvider("L2");
      const contract = new Contract(tokenAddress, ERC20ABI_default, l2Provider);
      const balance = await contract.balanceOf(accountAddress);
      return BigInt(balance.toString());
    } catch (error) {
      logger2.error(`Error fetching ERC20 balance for ${tokenAddress} / ${accountAddress}:`, error);
      throw error;
    }
  }
  // --- Staking Read Operations (L1) ---
  /**
   * Fetches detailed information about a specific validator from the L1 StakeManager.
   * @param validatorId The ID of the validator.
   * @returns A promise resolving to ValidatorInfo or null if not found.
   */
  async getValidatorInfo(validatorId) {
    logger2.debug(`Getting L1 validator info for ID: ${validatorId}`);
    try {
      const stakeManager = this.getStakeManagerContract();
      try {
        await stakeManager.validatorStake(validatorId);
      } catch (e) {
        logger2.warn(
          `Validator ID ${validatorId} not found or inactive. ${e instanceof Error ? e.message : String(e)}`
        );
        return null;
      }
      const [
        stake,
        validatorShareAddress
        // Add other relevant calls as needed
      ] = await Promise.all([
        stakeManager.validatorStake(validatorId),
        stakeManager.getValidatorContract(validatorId)
        // Add other contract methods here
      ]);
      const validatorStake = BigInt(stake.toString());
      let totalStake = validatorStake;
      try {
        const delegated = await stakeManager.delegatedAmount(validatorId);
        totalStake = totalStake + BigInt(delegated.toString());
      } catch (e) {
        logger2.warn(
          `Could not get delegated amount for validator ${validatorId}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      let status = 0 /* Inactive */;
      if (validatorShareAddress && validatorShareAddress !== ZeroAddress && totalStake > 0n) {
        status = 1 /* Active */;
      }
      let commissionRate = 0;
      const lastRewardUpdateEpoch = 0n;
      let signerAddress = "";
      if (validatorShareAddress && validatorShareAddress !== ZeroAddress) {
        try {
          const validatorShareContract = new Contract(
            validatorShareAddress,
            ValidatorShareABI_default,
            this.getProvider("L1")
          );
          if (typeof validatorShareContract.commissionRate === "function") {
            try {
              const commissionRateResult = await validatorShareContract.commissionRate();
              commissionRate = Number(commissionRateResult) / 1e4;
            } catch (e) {
              logger2.debug(
                `Commission rate not available for validator ${validatorId}: ${e instanceof Error ? e.message : String(e)}`
              );
            }
          }
          if (typeof validatorShareContract.owner === "function") {
            try {
              signerAddress = await validatorShareContract.owner();
            } catch (e) {
              logger2.debug(
                `Owner address not available for validator ${validatorId}: ${e instanceof Error ? e.message : String(e)}`
              );
            }
          }
        } catch (e) {
          logger2.warn(
            `Error interacting with ValidatorShare contract: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
      const info = {
        status,
        totalStake,
        commissionRate,
        signerAddress: signerAddress || ZeroAddress,
        activationEpoch: 0n,
        // We don't have this info directly
        deactivationEpoch: 0n,
        // We don't have this info directly
        jailEndEpoch: 0n,
        // We don't have this info directly
        contractAddress: validatorShareAddress || ZeroAddress,
        lastRewardUpdateEpoch
      };
      return info;
    } catch (error) {
      logger2.error(
        `Error fetching validator info for ID ${validatorId} from L1 StakeManager:`,
        error
      );
      throw error;
    }
  }
  /**
   * Fetches staking details for a specific delegator address related to a specific validator.
   * @param validatorId The ID of the validator.
   * @param delegatorAddress The address of the delegator.
   * @returns A promise resolving to DelegatorInfo or null if validator/delegator relationship not found.
   */
  async getDelegatorInfo(validatorId, delegatorAddress) {
    logger2.debug(
      `Getting L1 delegator info for validator ${validatorId} and delegator ${delegatorAddress}`
    );
    try {
      const stakeManager = this.getStakeManagerContract();
      const l1Provider = this.getProvider("L1");
      const validatorShareAddress = await stakeManager.getValidatorContract(validatorId);
      if (!validatorShareAddress || validatorShareAddress === ZeroAddress) {
        logger2.warn(`ValidatorShare contract address not found for validator ID ${validatorId}.`);
        return null;
      }
      const validatorShareContract = new Contract(
        validatorShareAddress,
        ValidatorShareABI_default,
        l1Provider
      );
      const [delegatedAmountResult, pendingRewardsResult] = await Promise.all([
        validatorShareContract.getTotalStake(delegatorAddress),
        // Verify name
        validatorShareContract.getLiquidRewards(delegatorAddress)
        // Verify name (often 'getLiquidRewards')
      ]);
      const info = {
        delegatedAmount: BigInt(delegatedAmountResult.toString()),
        pendingRewards: BigInt(pendingRewardsResult.toString())
      };
      return info;
    } catch (error) {
      logger2.error(
        `Error fetching delegator info for V:${validatorId}/D:${delegatorAddress} from L1:`,
        error
      );
      if (error instanceof Error && (error.message.includes("delegator never staked") || "code" in error && error.code === "CALL_EXCEPTION")) {
        logger2.warn(
          `Delegator ${delegatorAddress} likely has no stake with validator ${validatorId}.`
        );
        return null;
      }
      throw error;
    }
  }
  // --- L1 Staking Write Operations ---
  /**
   * Delegates MATIC to a validator on L1.
   * @param validatorId The ID of the validator.
   * @param amountWei Amount of MATIC/POL to delegate in Wei.
   * @returns Transaction hash of the delegation transaction.
   */
  async delegate(validatorId, amountWei) {
    logger2.info(
      `Initiating delegation of ${ethers.formatEther(amountWei)} MATIC to validator ${validatorId} on L1...`
    );
    if (amountWei <= 0n) {
      throw new Error("Delegation amount must be greater than zero.");
    }
    const signer = this.getL1Signer();
    const l1Provider = this.getProvider("L1");
    try {
      const validatorShareContract = await this._getValidatorShareContract(validatorId);
      if (!validatorShareContract.interface.getFunction("buyVoucher(uint256,uint256)")) {
        throw new Error("ValidatorShare contract does not expose buyVoucher(uint256,uint256)");
      }
      const maticToken = this.getMaticToken();
      const signerAddress = await signer.getAddress();
      logger2.debug(
        `Checking MATIC token allowance for validator share contract ${validatorShareContract.target}...`
      );
      const allowance = await maticToken.allowance(signerAddress, validatorShareContract.target);
      if (allowance < amountWei) {
        logger2.info(`Approving ${ethers.formatEther(amountWei)} MATIC for delegation...`);
        const approveTx = await maticToken.approve(validatorShareContract.target, amountWei);
        logger2.info(
          `MATIC approval transaction sent: ${approveTx.hash}. Waiting for confirmation...`
        );
        await approveTx.wait(1);
        logger2.info("MATIC approval confirmed. Proceeding with delegation.");
      } else {
        logger2.info(
          `Existing allowance of ${ethers.formatEther(allowance)} MATIC is sufficient. Skipping approval.`
        );
      }
      const txData = await validatorShareContract.buyVoucher.populateTransaction(amountWei, 0);
      const gasLimit = await signer.estimateGas({
        ...txData
      });
      const gasLimitBuffered = gasLimit * 120n / 100n;
      const { maxFeePerGas, maxPriorityFeePerGas } = await this._getL1FeeDetails();
      const walletBalance = await l1Provider.getBalance(signerAddress);
      const estFee = gasLimitBuffered * maxFeePerGas;
      const safety = ethers.parseUnits("0.002", "ether");
      if (walletBalance < estFee + safety) {
        throw new Error(
          `Insufficient ETH: you have ${ethers.formatEther(walletBalance)} but need about ${ethers.formatEther(estFee + safety)} for gas.`
        );
      }
      const tx = {
        ...txData,
        // Do not set value - this is an ERC20 transfer, not ETH
        gasLimit: gasLimitBuffered,
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: (await l1Provider.getNetwork()).chainId
        // Ensure correct chain ID
      };
      const nonce = await signer.getNonce();
      tx.nonce = nonce;
      logger2.debug("Transaction details:", {
        to: tx.to,
        gasLimit: tx.gasLimit?.toString(),
        maxFeePerGas: tx.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(),
        value: tx.value?.toString() || "undefined (correct - no ETH value should be sent)"
      });
      logger2.debug("Signing delegation transaction...");
      const signedTx = await signer.signTransaction(tx);
      logger2.info(`Broadcasting L1 delegation transaction for validator ${validatorId}...`);
      const txResponse = await this.sendRawTransaction(signedTx, "L1");
      logger2.info(`Delegation transaction sent: ${txResponse.hash}`);
      return txResponse.hash;
    } catch (error) {
      logger2.error(`Delegation to validator ${validatorId} failed:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Delegation failed: ${errorMessage}`);
    }
  }
  /**
   * Gets the MATIC token contract on Ethereum L1
   * @returns The MATIC token contract connected to the signer
   */
  getMaticToken() {
    const MATIC_TOKEN_ADDRESS = "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0";
    const signer = this.getL1Signer();
    return new Contract(MATIC_TOKEN_ADDRESS, ERC20ABI_default, signer);
  }
  /**
   * Initiates undelegation (unbonding) of shares from a validator on L1.
   * @param validatorId The ID of the validator.
   * @param sharesAmountWei Amount of Validator Shares to undelegate (in Wei).
   * @returns Transaction hash of the undelegation transaction.
   */
  async undelegate(validatorId, sharesAmountWei) {
    logger2.info(
      `Initiating undelegation of ${sharesAmountWei} shares from validator ${validatorId} on L1...`
    );
    if (sharesAmountWei <= 0n) {
      throw new Error("Undelegation shares amount must be greater than zero.");
    }
    const signer = this.getL1Signer();
    const l1Provider = this.getProvider("L1");
    const contract = await this._getValidatorShareContract(validatorId);
    try {
      if (!contract.interface.getFunction("sellVoucher(uint256,uint256)")) {
        throw new Error("ValidatorShare contract does not expose sellVoucher(uint256,uint256)");
      }
      const txData = await contract.sellVoucher.populateTransaction(sharesAmountWei, 0n);
      const gasLimit = await signer.estimateGas({ ...txData });
      const gasLimitBuffered = gasLimit * 120n / 100n;
      const { maxFeePerGas, maxPriorityFeePerGas } = await this._getL1FeeDetails();
      const tx = {
        ...txData,
        // No value field for undelegate
        gasLimit: gasLimitBuffered,
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: (await l1Provider.getNetwork()).chainId
      };
      logger2.debug("Signing undelegation transaction...", tx);
      const signedTx = await signer.signTransaction(tx);
      logger2.info(`Broadcasting L1 undelegation transaction for validator ${validatorId}...`);
      const txResponse = await this.sendRawTransaction(signedTx, "L1");
      logger2.info(`Undelegation transaction sent: ${txResponse.hash}`);
      return txResponse.hash;
    } catch (error) {
      logger2.error(`Undelegation from validator ${validatorId} failed:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Undelegation failed: ${errorMessage}`);
    }
  }
  /**
   * Withdraws pending rewards from a specific validator on L1.
   * @param validatorId The ID of the validator.
   * @returns Transaction hash of the reward withdrawal transaction.
   */
  async withdrawRewards(validatorId) {
    logger2.info(`Initiating reward withdrawal from validator ${validatorId} on L1...`);
    const signer = this.getL1Signer();
    const l1Provider = this.getProvider("L1");
    const contract = await this._getValidatorShareContract(validatorId);
    try {
      if (!contract.interface.getFunction("withdrawRewards()")) {
        throw new Error("ValidatorShare contract does not expose withdrawRewards()");
      }
      const txData = await contract.withdrawRewards.populateTransaction();
      const gasLimit = await signer.estimateGas({ ...txData });
      const gasLimitBuffered = gasLimit * 120n / 100n;
      const { maxFeePerGas, maxPriorityFeePerGas } = await this._getL1FeeDetails();
      const tx = {
        ...txData,
        // No value field for withdraw
        gasLimit: gasLimitBuffered,
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: (await l1Provider.getNetwork()).chainId
      };
      logger2.debug("Signing reward withdrawal transaction...", tx);
      const signedTx = await signer.signTransaction(tx);
      logger2.info(`Broadcasting L1 reward withdrawal transaction for validator ${validatorId}...`);
      const txResponse = await this.sendRawTransaction(signedTx, "L1");
      logger2.info(`Reward withdrawal transaction sent: ${txResponse.hash}`);
      return txResponse.hash;
    } catch (error) {
      logger2.error(`Reward withdrawal from validator ${validatorId} failed:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Reward withdrawal failed: ${errorMessage}`);
    }
  }
  /**
   * Convenience method to withdraw rewards and immediately restake them to the same validator.
   * @param validatorId The ID of the validator.
   * @returns Transaction hash of the *delegation* transaction, or null if no rewards to restake.
   */
  async restakeRewards(validatorId) {
    logger2.info(`Initiating restake for validator ${validatorId} on L1...`);
    const signer = this.getL1Signer();
    const delegatorAddress = await signer.getAddress();
    const l1Provider = this.getProvider("L1");
    const validatorShareContract = await this._getValidatorShareContract(validatorId);
    try {
      if (!validatorShareContract.interface.getFunction("getLiquidRewards(address)")) {
        throw new Error("ValidatorShare contract does not expose getLiquidRewards(address)");
      }
      if (!validatorShareContract.interface.getFunction("withdrawRewards()")) {
        throw new Error("ValidatorShare contract does not expose withdrawRewards()");
      }
      const delegatorInfo = await this.getDelegatorInfo(validatorId, delegatorAddress);
      const rewardsToRestake = delegatorInfo?.pendingRewards;
      if (!rewardsToRestake || rewardsToRestake <= 0n) {
        logger2.warn(
          `No pending rewards found for ${delegatorAddress} on validator ${validatorId}. Nothing to restake.`
        );
        return null;
      }
      logger2.info(`Found ${ethers.formatEther(rewardsToRestake)} MATIC rewards to restake.`);
      const withdrawTxHash = await this.withdrawRewards(validatorId);
      logger2.info(`Withdrawal tx sent (${withdrawTxHash}). Waiting for confirmation...`);
      const receipt = await l1Provider.waitForTransaction(withdrawTxHash, 1, 12e4);
      if (!receipt || receipt.status !== 1) {
        logger2.error(
          `Withdrawal transaction (${withdrawTxHash}) failed or timed out. Status: ${receipt?.status}`
        );
        throw new Error(`Reward withdrawal transaction failed (Hash: ${withdrawTxHash})`);
      }
      logger2.info("Withdrawal transaction confirmed.");
      logger2.info(
        `Proceeding to delegate ${ethers.formatEther(rewardsToRestake)} MATIC rewards...`
      );
      const delegateTxHash = await this.delegate(validatorId, rewardsToRestake);
      return delegateTxHash;
    } catch (error) {
      logger2.error(`Restake operation for validator ${validatorId} failed:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Restake failed: ${errorMessage}`);
    }
  }
  // --- L1 -> L2 Bridge Deposit ---
  /**
   * Bridges an ERC20 token (including POL) from Ethereum L1 to Polygon L2.
   * Handles approval if necessary.
   * @param tokenAddressL1 Address of the ERC20 token contract on L1.
   * @param amountWei Amount of the token to bridge in Wei.
   * @param recipientAddressL2 Optional address to receive tokens on L2, defaults to sender.
   * @returns Transaction hash of the final deposit transaction.
   */
  async bridgeDeposit(tokenAddressL1, amountWei, recipientAddressL2) {
    logger2.info(
      `Initiating L1->L2 bridge deposit of ${ethers.formatUnits(amountWei)} units for token ${tokenAddressL1}...`
    );
    if (amountWei <= 0n) {
      throw new Error("Bridge deposit amount must be greater than zero.");
    }
    const signer = this.getL1Signer();
    const l1Provider = this.getProvider("L1");
    const rootChainManager = this.getRootChainManagerContract();
    const userAddress = recipientAddressL2 || await signer.getAddress();
    try {
      await this._approveErc20IfNeeded(tokenAddressL1, amountWei, ROOT_CHAIN_MANAGER_ADDRESS_L1);
      const txDepositData = await rootChainManager.depositFor.populateTransaction(
        userAddress,
        tokenAddressL1,
        amountWei
      );
      const { maxFeePerGas, maxPriorityFeePerGas } = await this._getL1FeeDetails();
      const gasLimitDeposit = await signer.estimateGas({
        ...txDepositData,
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: (await l1Provider.getNetwork()).chainId
      });
      const tx = {
        ...txDepositData,
        gasLimit: gasLimitDeposit,
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: (await l1Provider.getNetwork()).chainId
      };
      logger2.debug("Signing depositFor transaction...", tx);
      const signedTx = await signer.signTransaction(tx);
      logger2.info(`Broadcasting L1 depositFor transaction for token ${tokenAddressL1}...`);
      const txResponse = await this.sendRawTransaction(signedTx, "L1");
      logger2.info(`Bridge deposit transaction sent: ${txResponse.hash}`);
      return txResponse.hash;
    } catch (error) {
      logger2.error(`Bridge deposit for token ${tokenAddressL1} failed:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Bridge deposit failed: ${errorMessage}`);
    }
  }
  // --- Helper: Approve ERC20 spending if needed ---
  async _approveErc20IfNeeded(tokenAddressL1, amountWei, spenderAddress) {
    const signer = this.getL1Signer();
    const l1Provider = this.getProvider("L1");
    const ownerAddress = await signer.getAddress();
    const tokenContract = new Contract(tokenAddressL1, ERC20ABI_default, signer);
    logger2.debug(
      `Checking allowance for ${ownerAddress} to spend ${tokenAddressL1} via ${spenderAddress}`
    );
    const currentAllowance = BigInt(
      (await tokenContract.allowance(ownerAddress, spenderAddress)).toString()
    );
    if (currentAllowance >= amountWei) {
      logger2.info(
        `Sufficient allowance (${ethers.formatUnits(currentAllowance)} tokens) already exists for ${tokenAddressL1}. Skipping approval.`
      );
      return null;
    }
    if (currentAllowance > 0n) {
      logger2.warn(
        `Existing allowance (${ethers.formatUnits(currentAllowance)}) is less than required. Resetting to 0 before approving new amount.`
      );
      try {
        const resetTxHash = await this._sendApproveTx(tokenContract, spenderAddress, 0n);
        await l1Provider.waitForTransaction(resetTxHash, 1, 12e4);
      } catch (error) {
        logger2.error("Failed to reset ERC20 allowance to 0:", error);
        throw new Error("Failed to reset existing allowance before approving.");
      }
    }
    logger2.info(
      `Approving ${spenderAddress} to spend ${ethers.formatUnits(amountWei)} of ${tokenAddressL1}...`
    );
    const approveAmount = MaxUint256;
    const approveTxHash = await this._sendApproveTx(tokenContract, spenderAddress, approveAmount);
    logger2.info(`Approve transaction sent (${approveTxHash}). Waiting for confirmation...`);
    const receipt = await l1Provider.waitForTransaction(approveTxHash, 1, 12e4);
    if (!receipt || receipt.status !== 1) {
      logger2.error(
        `Approve transaction (${approveTxHash}) failed or timed out. Status: ${receipt?.status}`
      );
      throw new Error(`ERC20 approval transaction failed (Hash: ${approveTxHash})`);
    }
    logger2.info(`Approval confirmed for ${tokenAddressL1}.`);
    return approveTxHash;
  }
  // Internal helper to construct and send an approve transaction
  async _sendApproveTx(tokenContract, spender, amount) {
    const signer = this.getL1Signer();
    const l1Provider = this.getProvider("L1");
    try {
      const txData = await tokenContract.approve.populateTransaction(spender, amount);
      const { maxFeePerGas, maxPriorityFeePerGas } = await this._getL1FeeDetails();
      const gasLimit = await signer.estimateGas({ ...txData });
      const gasLimitBuffered = gasLimit * 150n / 100n;
      const tx = {
        ...txData,
        gasLimit: gasLimitBuffered,
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: (await l1Provider.getNetwork()).chainId
      };
      const nonce = await signer.getNonce();
      tx.nonce = nonce;
      logger2.debug("Signing approve transaction...", tx);
      const signedTx = await signer.signTransaction(tx);
      logger2.info(`Broadcasting L1 approve transaction for token ${tokenContract.target}...`);
      const txResponse = await this.sendRawTransaction(signedTx, "L1");
      return txResponse.hash;
    } catch (error) {
      logger2.error(`ERC20 approve transaction failed for token ${tokenContract.target}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Approval failed: ${errorMessage}`);
    }
  }
  // Helper for L1 Fee Details
  async _getL1FeeDetails() {
    if (!this.l1Provider) throw new Error("L1 provider not initialized for fee data.");
    if (!this.runtime) throw new Error("Runtime not available for GasService access.");
    try {
      logger2.debug("Fetching gas prices from GasService...");
      const gasServiceEstimates = await getGasPriceEstimates(this.runtime);
      if (gasServiceEstimates?.estimatedBaseFee && gasServiceEstimates?.average?.maxPriorityFeePerGas) {
        const maxPriorityFeePerGas2 = gasServiceEstimates.average.maxPriorityFeePerGas;
        const maxFeePerGas2 = gasServiceEstimates.estimatedBaseFee + maxPriorityFeePerGas2;
        logger2.debug("Gas price details from GasService:", {
          baseFeeWei: gasServiceEstimates.estimatedBaseFee?.toString(),
          baseFeeGwei: ethers.formatUnits(gasServiceEstimates.estimatedBaseFee || 0n, "gwei"),
          priorityFeeWei: maxPriorityFeePerGas2.toString(),
          priorityFeeGwei: ethers.formatUnits(maxPriorityFeePerGas2, "gwei"),
          totalFeeWei: maxFeePerGas2.toString(),
          totalFeeGwei: ethers.formatUnits(maxFeePerGas2, "gwei")
        });
        if (Number(ethers.formatUnits(maxFeePerGas2, "gwei")) > 500) {
          logger2.warn(
            `Unusually high gas price (${ethers.formatUnits(maxFeePerGas2, "gwei")} gwei) \u2013 double-check the fee source or unit conversion.`
          );
        }
        logger2.debug("Using L1 fee details from GasService.");
        return { maxFeePerGas: maxFeePerGas2, maxPriorityFeePerGas: maxPriorityFeePerGas2 };
      }
    } catch (gsError) {
      logger2.warn(
        `GasService call failed or returned insufficient data: ${gsError instanceof Error ? gsError.message : String(gsError)}. Falling back to l1Provider.getFeeData().`
      );
    }
    logger2.debug("Falling back to l1Provider.getFeeData() for L1 fee details.");
    const feeData = await this.l1Provider.getFeeData();
    let maxFeePerGas = feeData.maxFeePerGas;
    let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    if (maxFeePerGas === null || maxPriorityFeePerGas === null) {
      if (feeData.gasPrice !== null) {
        logger2.warn(
          "L1 fee data: maxFeePerGas or maxPriorityFeePerGas is null, using gasPrice as fallback (legacy transaction type)."
        );
        maxFeePerGas = feeData.gasPrice;
        maxPriorityFeePerGas = feeData.gasPrice;
      } else {
        throw new Error(
          "Unable to obtain L1 fee data: getFeeData() returned all null for EIP-1559 fields and gasPrice."
        );
      }
    }
    if (maxFeePerGas === null || maxPriorityFeePerGas === null) {
      throw new Error("Unable to determine L1 fee details even after fallback attempts.");
    }
    logger2.debug("Gas price details from provider.getFeeData():", {
      maxFeePerGasWei: maxFeePerGas.toString(),
      maxFeePerGasGwei: ethers.formatUnits(maxFeePerGas, "gwei"),
      maxPriorityFeePerGasWei: maxPriorityFeePerGas.toString(),
      maxPriorityFeePerGasGwei: ethers.formatUnits(maxPriorityFeePerGas, "gwei")
    });
    if (Number(ethers.formatUnits(maxFeePerGas, "gwei")) > 500) {
      logger2.warn(
        `Unusually high gas price from provider (${ethers.formatUnits(maxFeePerGas, "gwei")} gwei) \u2013 double-check the fee source or unit conversion.`
      );
    }
    return { maxFeePerGas, maxPriorityFeePerGas };
  }
  // --- L2 Checkpoint Status Check (L1) ---
  /**
   * Fetches the last L2 block number included in a checkpoint on L1.
   * @returns A promise resolving to the last checkpointed L2 block number as a bigint.
   */
  async getLastCheckpointedL2Block() {
    logger2.debug(
      "Getting last checkpointed L2 block number from L1 RootChainManager/CheckpointManager..."
    );
    try {
      const rootChainManager = this.getRootChainManagerContract();
      if (!this.l1Provider) {
        throw new Error("L1 provider not initialized for CheckpointManager interaction.");
      }
      logger2.debug("Retrieving CheckpointManager address from RootChainManager...");
      let checkpointManagerAddr;
      try {
        checkpointManagerAddr = await rootChainManager.checkpointManagerAddress();
        logger2.debug(`CheckpointManager address retrieved: ${checkpointManagerAddr}`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger2.error(`Failed to get checkpointManagerAddress from RootChainManager: ${errMsg}`);
        logger2.debug("RootChainManager contract details:", {
          address: ROOT_CHAIN_MANAGER_ADDRESS_L1,
          methods: rootChainManager.interface.fragments.map((f) => typeof f === "object" && f.name ? f.name : "unnamed").join(", ")
        });
        throw new Error(`Failed to get CheckpointManager address from RootChainManager: ${errMsg}`);
      }
      if (!checkpointManagerAddr || checkpointManagerAddr === ZeroAddress) {
        logger2.error("Invalid CheckpointManager address:", checkpointManagerAddr);
        throw new Error(
          "CheckpointManager address not found or is zero address from RootChainManager."
        );
      }
      logger2.debug(
        `Creating CheckpointManager contract instance for address: ${checkpointManagerAddr}...`
      );
      const checkpointManager = new Contract(
        checkpointManagerAddr,
        CheckpointManagerABI_default,
        this.l1Provider
      );
      try {
        await this.l1Provider.getCode(checkpointManagerAddr);
        logger2.debug("Contract code exists at CheckpointManager address");
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger2.error(
          `Failed to verify CheckpointManager contract at ${checkpointManagerAddr}: ${errMsg}`
        );
        throw new Error(
          `CheckpointManager contract not found at ${checkpointManagerAddr}: ${errMsg}`
        );
      }
      logger2.debug("Retrieving currentHeaderBlock from CheckpointManager...");
      let lastHeaderNum;
      try {
        lastHeaderNum = await checkpointManager.currentHeaderBlock();
        logger2.debug(`Last header block number: ${lastHeaderNum}`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger2.error(`Failed to retrieve currentHeaderBlock from CheckpointManager: ${errMsg}`);
        logger2.debug("CheckpointManager contract details:", {
          address: checkpointManagerAddr,
          methods: checkpointManager.interface.fragments.map((f) => typeof f === "object" && f.name ? f.name : "unnamed").join(", ")
        });
        throw new Error(`Failed to retrieve currentHeaderBlock from CheckpointManager: ${errMsg}`);
      }
      if (lastHeaderNum === void 0 || lastHeaderNum === null) {
        logger2.error("Invalid currentHeaderBlock value:", lastHeaderNum);
        throw new Error("Failed to retrieve currentHeaderBlock from CheckpointManager.");
      }
      logger2.debug(`Retrieving header block details for block ${lastHeaderNum}...`);
      let headerBlockDetails;
      try {
        headerBlockDetails = await checkpointManager.headerBlocks(lastHeaderNum);
        logger2.debug(
          "HeaderBlock details retrieved:",
          JSON.stringify(headerBlockDetails, (_, v) => typeof v === "bigint" ? v.toString() : v)
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger2.error(
          `Failed to retrieve headerBlocks(${lastHeaderNum}) from CheckpointManager: ${errMsg}`
        );
        throw new Error(
          `Failed to retrieve headerBlock details for block ${lastHeaderNum}: ${errMsg}`
        );
      }
      if (!headerBlockDetails) {
        logger2.error("headerBlockDetails is null or undefined");
        throw new Error("Failed to retrieve headerBlock details: null or undefined result.");
      }
      let endBlock = headerBlockDetails.endBlock || headerBlockDetails.end;
      if (endBlock === void 0 && Array.isArray(headerBlockDetails)) {
        endBlock = headerBlockDetails[2];
      } else if (endBlock === void 0 && typeof headerBlockDetails === "object") {
        endBlock = headerBlockDetails[2];
      }
      if (endBlock === void 0 || endBlock === null) {
        logger2.error(
          "endBlock not found or is null in headerBlockDetails, full details:",
          JSON.stringify(headerBlockDetails, (_, v) => typeof v === "bigint" ? v.toString() : v)
        );
        throw new Error("Failed to retrieve endBlock from headerBlockDetails.");
      }
      const lastBlock = BigInt(endBlock.toString());
      logger2.info(`Last L2 block checkpointed on L1 (via CheckpointManager): ${lastBlock}`);
      return lastBlock;
    } catch (error) {
      logger2.error("Error fetching last checkpointed L2 block from L1:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get last checkpointed L2 block: ${errorMessage}`);
    }
  }
  /**
   * Checks if a given Polygon L2 block number has been included in a checkpoint on L1.
   * @param l2BlockNumber The L2 block number to check.
   * @returns A promise resolving to true if the block is checkpointed, false otherwise.
   */
  async isL2BlockCheckpointed(l2BlockNumber) {
    const targetBlock = BigInt(l2BlockNumber.toString());
    logger2.debug(`Checking if L2 block ${targetBlock} is checkpointed on L1...`);
    try {
      logger2.debug("Retrieving last checkpointed block from L1...");
      const lastCheckpointedBlock = await this.getLastCheckpointedL2Block();
      logger2.debug(
        `Comparing target block ${targetBlock} with last checkpointed block ${lastCheckpointedBlock}`
      );
      const isCheckpointed = targetBlock <= lastCheckpointedBlock;
      logger2.info(
        `L2 block ${targetBlock} checkpointed status: ${isCheckpointed} (Last Checkpointed: ${lastCheckpointedBlock})`
      );
      return isCheckpointed;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger2.error(
        `Could not determine checkpoint status for L2 block ${targetBlock} due to error fetching last checkpoint: ${errorMessage}`,
        error
      );
      throw new Error(
        `Failed to determine checkpoint status for L2 block ${targetBlock}: ${errorMessage}`
      );
    }
  }
};
_PolygonRpcService.serviceType = "polygonRpc";
var PolygonRpcService = _PolygonRpcService;

// src/templates/index.ts
var getValidatorInfoTemplate = `You are an AI assistant. Your task is to extract the validator ID from the user's message.
The validator ID must be a positive integer.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the validator ID.

Respond with a JSON markdown block containing only the extracted validator ID.
The JSON should have this structure:
\`\`\`json
{
    "validatorId": number
}
\`\`\`

If no valid validator ID is found, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Validator ID not found or invalid. Please specify a positive integer for the validator ID."
}
\`\`\`
`;
var getDelegatorInfoTemplate = `You are an AI assistant. Your task is to extract the validator ID and optionally a delegator address from the user's message.
The validator ID must be a positive integer.
The delegator address, if provided by the user, must be a valid Ethereum-style address (starting with 0x).

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the validator ID and delegator address (if specified by the user).

Respond with a JSON markdown block containing only the extracted values.
The JSON should have this structure:
\`\`\`json
{
    "validatorId": number,
    "delegatorAddress"?: string
}
\`\`\`
If 'delegatorAddress' is not mentioned by the user, omit it from the JSON.

If no valid validator ID is found, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Validator ID not found or invalid. Please specify a positive integer for the validator ID."
}
\`\`\`
`;
var delegateL1Template = `You are an AI assistant. Your task is to extract the validator ID and the amount to delegate from the user's message.
The validator ID must be a positive integer.
The amount must be a positive number, representing the amount in the smallest unit (Wei) as a string.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the validator ID and the amount to delegate.

Respond with a JSON markdown block containing only the extracted values.
The JSON should have this structure:
\`\`\`json
{
    "validatorId": number,
    "amountWei": string
}
\`\`\`

If no valid validator ID or amount is found, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Validator ID or amount not found or invalid. Please specify a positive integer for the validator ID and a positive amount in Wei (as a string)."
}
\`\`\`
`;
var undelegateL1Template = `You are an AI assistant. Your task is to extract the validator ID and the amount of shares to undelegate from the user's message.
The validator ID must be a positive integer.
The shares amount must be a positive number, representing the amount of validator shares in the smallest unit (Wei) as a string.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the validator ID and the amount of shares to undelegate.

Respond with a JSON markdown block containing only the extracted values.
The JSON should have this structure:
\`\`\`json
{
    "validatorId": number,
    "sharesAmountWei": string
}
\`\`\`

If no valid validator ID or shares amount is found, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Validator ID or shares amount not found or invalid. Please specify a positive integer for the validator ID and a positive amount of shares in Wei (as a string)."
}
\`\`\`
`;
var withdrawRewardsTemplate = `You are an AI assistant. Your task is to extract the validator ID from the user's message for withdrawing staking rewards.
The validator ID must be a positive integer.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the validator ID from which to withdraw rewards.

Respond with a JSON markdown block containing only the extracted validator ID.
The JSON should have this structure:
\`\`\`json
{
    "validatorId": number
}
\`\`\`

If no valid validator ID is found, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Validator ID not found or invalid. Please specify a positive integer for the validator ID."
}
\`\`\`
`;
var restakeRewardsL1Template = `You are an AI assistant. Your task is to extract the validator ID from the user's message for a restake rewards operation on L1.
The validator ID must be a positive integer.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the validator ID for which to restake rewards.

Respond with a JSON markdown block containing only the extracted validator ID.
The JSON should have this structure:
\`\`\`json
{
    "validatorId": number
}
\`\`\`

If no valid validator ID is found, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Validator ID not found or invalid. Please specify a positive integer for the validator ID."
}
\`\`\`
`;
var bridgeDepositPolygonTemplate = `You are an AI assistant. Your task is to extract parameters for a bridge deposit between blockchain networks.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, extract the following parameters:
- fromChain: The source blockchain network (e.g., "ethereum", "polygon", "arbitrum")
- toChain: The destination blockchain network (e.g., "ethereum", "polygon", "arbitrum")
- fromToken: The token address on the source chain (string starting with 0x)
- toToken: The token address on the destination chain (string starting with 0x)
- amount: The amount to bridge (string, representing the human-readable amount)
- toAddress (optional): The recipient address on the destination chain (string starting with 0x)

Important notes: 
- Always use "ethereum" (not "mainnet") when referring to the Ethereum network
- Always use "polygon" when referring to the Polygon network
- Always use "arbitrum" when referring to the Arbitrum network

Respond with a JSON markdown block containing only the extracted values.
The JSON should have this structure and MUST NOT include any comments:
\`\`\`json
{
    "fromChain": string,
    "toChain": string,
    "fromToken": string,
    "toToken": string,
    "amount": string,
    "toAddress"?: string
}
\`\`\`
If 'toAddress' is not mentioned by the user, omit it from the JSON.

IMPORTANT: Your JSON response must be valid JSON without any comments or explanatory text. Do not include // comments or /* */ style comments in the JSON.

If the required parameters are not found or invalid, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Missing or invalid parameters. Please provide source chain, destination chain, token addresses and amount."
}
\`\`\`

Example valid tokens:
- Ethereum MATIC: 0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0
- Ethereum USDC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
- Ethereum WETH: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
- Polygon MATIC: 0x0000000000000000000000000000000000001010
- Polygon USDC: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
- Polygon WETH: 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619
- Arbitrum USDC: 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8
- Arbitrum WETH: 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1

Always use the appropriate token address for the specified chains.`;
var proposeGovernanceActionTemplate = `You are an AI assistant. Your task is to extract parameters for submitting a new governance proposal.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify:
- chain: The blockchain name (e.g., "polygon").
- governorAddress: The address of the Governor contract.
- targets: An array of target contract addresses.
- values: An array of ETH values (strings) for each action.
- calldatas: An array of hex-encoded calldata for each action.
- description: The full text description of the proposal.

Respond with a JSON markdown block containing only the extracted values.
The JSON should have this structure:
\`\`\`json
{
    "chain": "string",
    "governorAddress": "0xstring",
    "targets": ["0xstring"],
    "values": ["string"],
    "calldatas": ["0xstring"],
    "description": "string"
}
\`\`\`

If any required parameters are missing or unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Could not determine all required governance proposal parameters (chain, governorAddress, targets, values, calldatas, description). Please clarify your request."
}
\`\`\`
`;
var voteGovernanceActionTemplate = `You are an AI assistant. Your task is to extract parameters for voting on a governance proposal.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify:
- chain: The blockchain name (e.g., "polygon").
- governorAddress: The address of the Governor contract.
- proposalId: The ID of the proposal to vote on.
- support: The vote option (0 for Against, 1 for For, 2 for Abstain).
- reason (optional): The reason for the vote.

Respond with a JSON markdown block containing only the extracted values.
The JSON should have this structure:
\`\`\`json
{
    "chain": "string",
    "governorAddress": "0xstring",
    "proposalId": "string",
    "support": number,
    "reason"?: "string"
}
\`\`\`

If any required parameters (chain, governorAddress, proposalId, support) are missing or unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Could not determine all required voting parameters (chain, governorAddress, proposalId, support). Please clarify your request."
}
\`\`\`
`;
var heimdallVoteActionTemplate = `You are an AI assistant. Your task is to extract parameters for voting on a Heimdall governance proposal.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify:
- proposalId: The ID of the Heimdall proposal (string or number).
- option: The vote option (numeric value like 0, 1, 2, 3, 4, or string like YES, NO, ABSTAIN).

Respond with a JSON markdown block containing only the extracted values.
The JSON should have this structure:
\`\`\`json
{
    "proposalId": "string | number",
    "option": "number | string"
}
\`\`\`

If any required parameters (proposalId, option) are missing or unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Could not determine all required Heimdall voting parameters (proposalId, option). Please clarify your request."
}
\`\`\`
`;
var heimdallSubmitProposalActionTemplate = `You are an AI assistant. Your task is to extract parameters for submitting a new governance proposal (Text or ParameterChange) to Heimdall.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify:
- content: An object representing the proposal content. It must have a "type" field ("TextProposal" or "ParameterChangeProposal").
  - For TextProposal: "title" (string), "description" (string).
  - For ParameterChangeProposal: "title" (string), "description" (string), "changes" (array of {subspace: string, key: string, value: string}).
- initialDepositAmount: The amount of the initial deposit for the proposal (string, e.g., "10000000").
- initialDepositDenom (optional): The denomination of the initial deposit (default: "matic").

Respond with a JSON markdown block containing only the extracted values.
The JSON should have this structure:
\`\`\`json
{
    "content": {
        "type": "TextProposal" | "ParameterChangeProposal",
        "title": "string",
        "description": "string",
        "changes": [{ "subspace": "string", "key": "string", "value": "string" }] // Only for ParameterChangeProposal
    },
    "initialDepositAmount": "string",
    "initialDepositDenom": "string" // e.g., "matic"
}
\`\`\`

Example for TextProposal content:
{
    "type": "TextProposal",
    "title": "Network Upgrade Info",
    "description": "Details about upcoming v2 upgrade."
}

Example for ParameterChangeProposal content:
{
    "type": "ParameterChangeProposal",
    "title": "Update Staking Param",
    "description": "Increase max validators",
    "changes": [
        { "subspace": "staking", "key": "MaxValidators", "value": "120" }
    ]
}

If any required parameters are missing or unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Could not determine all required Heimdall proposal parameters (content type, title, description, initialDepositAmount, and changes if ParameterChangeProposal). Please clarify your request."
}
\`\`\`
`;
var heimdallTransferTokensActionTemplate = `You are an AI assistant. Your task is to extract parameters for transferring native tokens on the Heimdall network.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify:
- recipientAddress: The Heimdall address of the recipient (must start with "heimdall" or "heimdallvaloper").
- amount: The amount of tokens to transfer in Wei (string of digits, e.g., "1000000000000000000").
- denom (optional): The denomination of the tokens (default: "matic").

Respond with a JSON markdown block containing only the extracted values.
The JSON should have this structure:
\`\`\`json
{
    "recipientAddress": "string",
    "amount": "string",
    "denom": "string" // e.g., "matic" or "uatom"
}
\`\`\`

If any required parameters (recipientAddress, amount) are missing or unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Could not determine all required Heimdall transfer parameters (recipientAddress, amount). Please clarify your request."
}
\`\`\`
`;
var getCheckpointStatusTemplate = `You are an AI assistant. Your task is to extract the block number from the user's message to check its checkpoint status.
The block number must be a positive integer.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the Polygon L2 block number to check.

Respond with a JSON markdown block containing only the extracted block number.
The JSON should have this structure:
\`\`\`json
{
    "blockNumber": number
}
\`\`\`

If no valid block number is found, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Block number not found or invalid. Please specify a positive integer for the block number."
}
\`\`\`
`;
var isL2BlockCheckpointedTemplate = `You are an AI assistant. Your task is to extract the block number from the user's message to check if it has been checkpointed.
The block number must be a positive integer. Extract the block number from the user's most recent message if multiple messages are provided.
Do not return anything other than the block number requested to be checked in the following json format.

Review the recent messages:
<recent_messages>
{{recentMessages}}
</recent_messages>

Based on the conversation, identify the Polygon L2 block number to check if it has been checkpointed.

Respond with a JSON markdown block containing only the extracted block number.
The JSON should have this structure:
\`\`\`json
{
    "l2BlockNumber": number
}
\`\`\`

If no valid block number is found, or if the user's intent is unclear, you MUST respond with the following JSON structure:
\`\`\`json
{
    "error": "Block number not found or invalid. Please specify a positive integer for the block number."
}
\`\`\`
`;

// src/errors.ts
var ValidationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
};
var ContractError = class extends Error {
  constructor(message, contractAddress, functionName) {
    super(message);
    this.contractAddress = contractAddress;
    this.functionName = functionName;
    this.name = "ContractError";
  }
};
var ServiceError = class extends Error {
  constructor(message, serviceName) {
    super(message);
    this.serviceName = serviceName;
    this.name = "ServiceError";
  }
};
function formatErrorMessage(action, message, details) {
  let formattedMessage = `${action} failed: ${message}`;
  if (details) {
    formattedMessage += `. Details: ${details}`;
  }
  return formattedMessage;
}
function parseErrorMessage(error) {
  if (error instanceof Error) {
    return { message: error.message, details: error.stack };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (typeof error === "object" && error !== null) {
    let message = "Unknown object error";
    let details;
    if ("message" in error && typeof error.message === "string") {
      message = error.message;
    }
    if ("reason" in error && typeof error.reason === "string") {
      message = error.reason;
    }
    if ("data" in error && typeof error.data === "string") {
      details = error.data;
    } else if ("stack" in error && typeof error.stack === "string") {
      details = error.stack;
    }
    if (message === "Unknown object error" && "error" in error && typeof error.error === "object" && error.error !== null) {
      const nestedError = error.error;
      if ("message" in nestedError && typeof nestedError.message === "string") {
        message = nestedError.message;
      }
      if ("data" in nestedError && typeof nestedError.data === "string") {
        details = `${details ? `${details}; ` : ""}${nestedError.data}`;
      }
    }
    if (message === "Unknown object error") {
      try {
        details = JSON.stringify(error);
      } catch (e) {
        details = "Unserializable error object";
      }
    }
    return { message, details };
  }
  return { message: "Unknown error" };
}

// src/actions/delegateL1.ts
function extractParamsFromText(text) {
  const params = {};
  const validatorIdMatch = text.match(/validator(?: id)?\\s*[:#]?\\s*(\\d+)/i);
  if (validatorIdMatch?.[1]) {
    const id = Number.parseInt(validatorIdMatch[1], 10);
    if (id > 0) {
      params.validatorId = id;
    }
  }
  const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(MATIC|ETH|ether)\b/i);
  if (amountMatch?.[1]) {
    try {
      params.amountWei = parseUnits2(amountMatch[1], 18).toString();
    } catch (e) {
      logger3.warn(`Could not parse amount from text: ${amountMatch[1]}`, e);
    }
  }
  return params;
}
var delegateL1Action = {
  name: "DELEGATE_L1",
  similes: ["STAKE_L1_MATIC", "DELEGATE_TO_VALIDATOR_L1", "STAKE_ON_ETHEREUM_L1"],
  description: "Delegates (stakes) MATIC/POL tokens to a specified Polygon validator on the Ethereum L1 network.",
  validate: async (runtime, _message, _state) => {
    logger3.debug("Validating DELEGATE_L1 action...");
    const requiredSettings = [
      "PRIVATE_KEY",
      "ETHEREUM_RPC_URL",
      // L1 RPC needed for delegation
      "POLYGON_PLUGINS_ENABLED"
      // Ensure main plugin toggle is on
    ];
    for (const setting of requiredSettings) {
      if (!runtime.getSetting(setting)) {
        logger3.error(`Required setting ${setting} not configured for DELEGATE_L1 action.`);
        return false;
      }
    }
    try {
      const service = runtime.getService(PolygonRpcService.serviceType);
      if (!service) {
        logger3.error("PolygonRpcService not initialized for DELEGATE_L1.");
        return false;
      }
    } catch (error) {
      logger3.error("Error accessing PolygonRpcService during DELEGATE_L1 validation:", error);
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _recentMessages) => {
    logger3.info("Handling DELEGATE_L1 action for message:", message.id);
    const rawMessageText = message.content.text || "";
    let params = null;
    try {
      const polygonService = runtime.getService(PolygonRpcService.serviceType);
      if (!polygonService) {
        throw new Error("PolygonRpcService not available");
      }
      const prompt = composePromptFromState2({
        state,
        template: delegateL1Template
      });
      try {
        const result = await runtime.useModel(ModelType2.TEXT_SMALL, {
          prompt
        });
        params = parseJSONObjectFromText(result);
        logger3.debug("DELEGATE_L1: Extracted params via TEXT_SMALL:", params);
        if (params.error) {
          logger3.warn(`DELEGATE_L1: Model responded with error: ${params.error}`);
          throw new Error(params.error);
        }
      } catch (e) {
        logger3.warn(
          "DELEGATE_L1: Failed to parse JSON from model response, trying manual extraction",
          e
        );
        const manualParams = extractParamsFromText(rawMessageText);
        if (manualParams.validatorId && manualParams.amountWei) {
          params = {
            validatorId: manualParams.validatorId,
            amountWei: manualParams.amountWei
          };
          logger3.debug("DELEGATE_L1: Extracted params via manual text parsing:", params);
        } else {
          throw new Error("Could not determine validator ID or amount from the message.");
        }
      }
      if (!params?.validatorId || !params.amountWei) {
        throw new Error("Validator ID or amount is missing after extraction attempts.");
      }
      const { validatorId, amountWei } = params;
      logger3.debug(`DELEGATE_L1 parameters: validatorId: ${validatorId}, amountWei: ${amountWei}`);
      const amountBigInt = BigInt(amountWei);
      const txHash = await polygonService.delegate(validatorId, amountBigInt);
      const amountFormatted = ethers2.formatEther(amountWei);
      const successMsg = `Successfully initiated delegation of ${amountFormatted} MATIC to validator ${validatorId}. Transaction hash: ${txHash}`;
      logger3.info(successMsg);
      const responseContent = {
        text: successMsg,
        actions: ["DELEGATE_L1"],
        source: message.content.source,
        data: {
          transactionHash: txHash,
          status: "pending",
          validatorId,
          amountDelegatedMatic: amountFormatted,
          amountDelegatedWei: amountWei
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } catch (error) {
      const parsedError = parseErrorMessage(error);
      logger3.error("Error in DELEGATE_L1 handler:", parsedError);
      let errorText = parsedError.message;
      if (errorText.includes("insufficient funds")) {
        try {
          const matches = errorText.match(/address (0x[a-fA-F0-9]+) have ([\d.]+) want ([\d.]+)/i);
          if (matches && matches.length >= 4) {
            const have = ethers2.parseEther(matches[2]);
            const want = ethers2.parseEther(matches[3]);
            const missing = want - have;
            errorText = `Insufficient ETH for delegation. You have ${ethers2.formatEther(have)} ETH but need ${ethers2.formatEther(want)} ETH (missing ${ethers2.formatEther(missing)} ETH). Please fund your wallet with more ETH to cover the transaction cost.`;
            if (want > ethers2.parseEther("0.05")) {
              errorText += "\n\nNOTE: The required ETH amount appears unusually high. This typically indicates one of two issues:\n1. Your MATIC amount is being sent as transaction value instead of using token approval\n2. Gas price is being calculated incorrectly (possibly using 18 decimals instead of 'gwei')\nThe normal gas cost for delegation is ~0.005-0.015 ETH.";
            }
          } else {
            errorText = "Insufficient ETH to cover transaction fees. Please fund your wallet with more ETH (typically 0.005-0.015 ETH is enough) and try again.";
          }
        } catch (parseErr) {
          logger3.warn("Error parsing amounts from insufficient funds error:", parseErr);
          errorText = "Insufficient ETH to cover transaction fees. Please fund your wallet with ~0.01 ETH and try again.";
        }
      }
      const errorContent = {
        text: `Error delegating MATIC (L1): ${errorText}`,
        actions: ["DELEGATE_L1"],
        source: message.content.source,
        data: {
          success: false,
          error: parsedError.message,
          details: parsedError.details,
          // Add diagnostic information about the transaction parameters
          diagnostics: {
            validatorId: params?.validatorId,
            amountMaticRequested: params?.amountWei ? ethers2.formatEther(params.amountWei) : "unknown",
            amountWei: params?.amountWei || "unknown"
          }
        }
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "I want to delegate 10 MATIC to validator 123 on L1"
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "Stake 5.5 MATIC with the Polygon validator ID 42 for L1 staking"
        }
      }
    ]
  ]
};

// src/actions/getCheckpointStatus.ts
import {
  logger as logger4,
  composePromptFromState as composePromptFromState3,
  ModelType as ModelType3,
  parseJSONObjectFromText as parseJSONObjectFromText2
} from "@elizaos/core";
var getCheckpointStatusAction = {
  name: "GET_CHECKPOINT_STATUS",
  similes: ["CHECK_CHECKPOINT", "POLYGON_CHECKPOINT_STATE"],
  description: "Checks if a Polygon L2 block has been checkpointed to Ethereum L1.",
  validate: async (runtime, _message, _state) => {
    logger4.debug("Validating GET_CHECKPOINT_STATUS action...");
    const requiredSettings = [
      "PRIVATE_KEY",
      "ETHEREUM_RPC_URL",
      // L1 RPC needed for checkpoint verification
      "POLYGON_RPC_URL",
      // L2 RPC for completeness
      "POLYGON_PLUGINS_ENABLED"
    ];
    for (const setting of requiredSettings) {
      if (!runtime.getSetting(setting)) {
        logger4.error(
          `Required setting ${setting} not configured for GET_CHECKPOINT_STATUS action.`
        );
        return false;
      }
    }
    try {
      const service = runtime.getService(PolygonRpcService.serviceType);
      if (!service) {
        logger4.error("PolygonRpcService not initialized.");
        return false;
      }
    } catch (error) {
      logger4.error("Error accessing PolygonRpcService during validation:", error);
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _responses) => {
    logger4.info("Handling GET_CHECKPOINT_STATUS action for message:", message.id);
    try {
      const polygonService = runtime.getService(PolygonRpcService.serviceType);
      if (!polygonService) {
        throw new Error("PolygonRpcService not available");
      }
      const prompt = composePromptFromState3({
        state,
        template: getCheckpointStatusTemplate
      });
      const modelResponse = await runtime.useModel(ModelType3.TEXT_SMALL, {
        prompt
      });
      let params;
      try {
        params = parseJSONObjectFromText2(modelResponse);
        logger4.debug("GET_CHECKPOINT_STATUS: Extracted params:", params);
        if (params.error) {
          logger4.warn(`GET_CHECKPOINT_STATUS: Model responded with error: ${params.error}`);
          throw new Error(params.error);
        }
      } catch (error) {
        logger4.error(
          "Failed to parse LLM response for checkpoint parameters:",
          modelResponse,
          error
        );
        throw new Error("Could not understand checkpoint parameters.");
      }
      if (params.blockNumber === void 0) {
        throw new Error("Block number parameter not extracted properly.");
      }
      logger4.debug("Checkpoint parameters:", params);
      const currentBlockNumber = await polygonService.getCurrentBlockNumber();
      const lastCheckpointedBlock = await polygonService.getLastCheckpointedL2Block();
      const isCheckpointed = await polygonService.isL2BlockCheckpointed(params.blockNumber);
      const status = {
        blockNumber: params.blockNumber,
        isCheckpointed,
        lastCheckpointedBlock
      };
      let responseMsg = `Polygon block ${params.blockNumber} ${isCheckpointed ? "is" : "is not"} checkpointed on Ethereum.`;
      responseMsg += ` Last checkpointed block: ${lastCheckpointedBlock.toString()}`;
      if (!isCheckpointed && params.blockNumber > Number(lastCheckpointedBlock)) {
        const blocksRemaining = params.blockNumber - Number(lastCheckpointedBlock);
        responseMsg += ` (${blocksRemaining} blocks pending)`;
      }
      if (params.blockNumber > currentBlockNumber) {
        responseMsg += ` Note: Block ${params.blockNumber} is in the future (current block: ${currentBlockNumber})`;
      }
      logger4.info(responseMsg);
      const responseContent = {
        text: responseMsg,
        actions: ["GET_CHECKPOINT_STATUS"],
        source: message.content.source,
        data: {
          blockNumber: params.blockNumber,
          currentBlockNumber,
          lastCheckpointedBlock: lastCheckpointedBlock.toString(),
          isCheckpointed
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger4.error("Error in GET_CHECKPOINT_STATUS handler:", errMsg, error);
      const errorContent = {
        text: `Error checking checkpoint status: ${errMsg}`,
        actions: ["GET_CHECKPOINT_STATUS"],
        source: message.content.source,
        data: { success: false, error: errMsg }
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Check if Polygon block 42000000 has been checkpointed"
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "Has block 41500000 on Polygon been checkpointed to Ethereum yet?"
        }
      }
    ]
  ]
};

// src/actions/proposeGovernance.ts
import {
  logger as logger5,
  composePromptFromState as composePromptFromState4,
  ModelType as ModelType4,
  parseJSONObjectFromText as parseJSONObjectFromText3
} from "@elizaos/core";
import {
  encodeFunctionData,
  parseUnits as parseUnits3
} from "viem";
var governorProposeAbi = [
  {
    inputs: [
      { name: "targets", type: "address[]" },
      { name: "values", type: "uint256[]" },
      { name: "calldatas", type: "bytes[]" },
      { name: "description", type: "string" }
    ],
    name: "propose",
    outputs: [{ name: "proposalId", type: "uint256" }],
    stateMutability: "nonpayable",
    // or 'payable' if it can receive value
    type: "function"
  }
];
function extractProposeGovernanceParamsFromText(text) {
  const params = {};
  logger5.debug(`Attempting to extract ProposeGovernanceParams from text: "${text}"`);
  const chainMatch = text.match(/\b(?:on\s+|chain\s*[:\-]?\s*)(\w+)/i);
  if (chainMatch?.[1]) params.chain = chainMatch[1].toLowerCase();
  const governorMatch = text.match(/\b(?:governor\s*(?:address\s*)?[:\-]?\s*)(0x[a-fA-F0-9]{40})/i);
  if (governorMatch?.[1]) params.governorAddress = governorMatch[1];
  const targetsRgx = /\btargets?\s*[:\-]?\s*\[?((?:0x[a-fA-F0-9]{40}(?:\s*,\s*|\s+)?)+)\]?/i;
  const targetsMatch = text.match(targetsRgx);
  if (targetsMatch?.[1]) {
    params.targets = targetsMatch[1].split(/[\s,]+/).filter((t) => /^0x[a-fA-F0-9]{40}$/.test(t));
  }
  const valuesRgx = /\bvalues?\s*[:\-]?\s*\[?((?:\d+(?:\.\d+)?(?:\s*,\s*|\s+)?)+)\]?/i;
  const valuesMatch = text.match(valuesRgx);
  if (valuesMatch?.[1]) {
    params.values = valuesMatch[1].split(/[\s,]+/).filter((v) => /^\d+(?:\.\d+)?$/.test(v));
  }
  const calldatasRgx = /\bcalldatas?\s*[:\-]?\s*\[?((?:0x[a-fA-F0-9]+(?:\s*,\s*|\s+)?)+)\]?/i;
  const calldatasMatch = text.match(calldatasRgx);
  if (calldatasMatch?.[1]) {
    params.calldatas = calldatasMatch[1].split(/[\s,]+/).filter((c) => /^0x[a-fA-F0-9]+$/.test(c));
  }
  const descriptionMatch = text.match(
    /\b(?:desc(?:ription)?\s*[:\-]?\s*)(?:(?:['"""](.+?)['"'"])|(.*?)(?:\s*\b(?:chain|governor|targets|values|calldatas)\b|$))/i
  );
  if (descriptionMatch) {
    params.description = (descriptionMatch[1] || descriptionMatch[2])?.trim();
  }
  logger5.debug("Manually extracted ProposeGovernanceParams:", params);
  return params;
}
var PolygonProposeGovernanceActionRunner = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  // Use imported WalletProvider
  async propose(params) {
    const walletClient = this.walletProvider.getWalletClient(params.chain);
    const publicClient = this.walletProvider.getPublicClient(params.chain);
    const chainConfig = this.walletProvider.getChainConfigs(params.chain);
    if (!walletClient.account) {
      throw new Error("Wallet client account is not available.");
    }
    const senderAddress = walletClient.account.address;
    const processedValues = params.values.map((valueStr) => {
      const lowerValueStr = valueStr.toLowerCase();
      const decimals = 18;
      if (lowerValueStr.includes("eth") || lowerValueStr.includes("matic")) {
        const numericPart = valueStr.replace(/\\s*(eth|matic)/i, "").trim();
        try {
          return parseUnits3(numericPart, decimals).toString();
        } catch (e) {
          logger5.warn(
            `Could not parse value "${valueStr}" with parseUnits. Attempting direct BigInt conversion of numeric part "${numericPart}".`
          );
          return numericPart;
        }
      }
      return valueStr;
    });
    const numericValues = processedValues.map((v) => {
      try {
        return BigInt(v);
      } catch (e) {
        logger5.error(
          `Failed to convert processed value "${v}" to BigInt. Original param values: ${JSON.stringify(params.values)}`
        );
        throw new Error(
          `Invalid numeric value for transaction: "${v}". Expected a number string convertible to BigInt (wei).`
        );
      }
    });
    const txData = encodeFunctionData({
      abi: governorProposeAbi,
      functionName: "propose",
      args: [params.targets, numericValues, params.calldatas, params.description]
    });
    try {
      logger5.debug(
        `Proposing on ${params.chain} to ${params.governorAddress} with description "${params.description}"`
      );
      const kzg = {
        blobToKzgCommitment: (_blob) => {
          throw new Error("KZG not impl.");
        },
        computeBlobKzgProof: (_blob, _commit) => {
          throw new Error("KZG not impl.");
        }
      };
      const hash = await walletClient.sendTransaction({
        account: senderAddress,
        to: params.governorAddress,
        value: BigInt(0),
        data: txData,
        chain: chainConfig,
        kzg
      });
      logger5.info(`Proposal transaction sent. Hash: ${hash}. Waiting for receipt...`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      logger5.debug("Transaction receipt:", receipt);
      let proposalId;
      const proposalCreatedEventAbi = governorProposeAbi.find((item) => item.name === "propose");
      return {
        hash,
        from: senderAddress,
        to: params.governorAddress,
        value: BigInt(0),
        data: txData,
        chainId: chainConfig.id,
        logs: receipt.logs,
        proposalId
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger5.error(`Governance proposal failed: ${errMsg}`, error);
      throw new Error(`Governance proposal failed: ${errMsg}`);
    }
  }
};
var proposeGovernanceAction = {
  name: "PROPOSE_GOVERNANCE_POLYGON",
  similes: ["CREATE_POLYGON_PROPOSAL", "SUBMIT_POLYGON_GOVERNANCE_ACTION"],
  description: "Submits a new governance proposal using the Polygon WalletProvider.",
  validate: async (runtime, _message, _state) => {
    logger5.debug("Validating PROPOSE_GOVERNANCE_POLYGON action...");
    const checks = [
      runtime.getSetting("WALLET_PRIVATE_KEY"),
      runtime.getSetting("POLYGON_PLUGINS_ENABLED")
    ];
    if (checks.some((check) => !check)) {
      logger5.error(
        "Required settings (WALLET_PRIVATE_KEY, POLYGON_PLUGINS_ENABLED) are not configured."
      );
      return false;
    }
    try {
      await initWalletProvider(runtime);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger5.error(`WalletProvider initialization failed during validation: ${errMsg}`);
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _responses) => {
    logger5.info("Handling PROPOSE_GOVERNANCE_POLYGON for message:", message.id);
    const rawMessageText = message.content.text || "";
    let extractedParams = null;
    try {
      const walletProvider = await initWalletProvider(runtime);
      const actionRunner = new PolygonProposeGovernanceActionRunner(walletProvider);
      const prompt = composePromptFromState4({
        state,
        template: proposeGovernanceActionTemplate
      });
      const modelResponse = await runtime.useModel(ModelType4.TEXT_SMALL, {
        prompt
      });
      try {
        const parsed = parseJSONObjectFromText3(modelResponse);
        if (parsed) {
          extractedParams = parsed;
        }
        logger5.debug(
          "PROPOSE_GOVERNANCE_POLYGON: Extracted params via TEXT_SMALL:",
          extractedParams
        );
        if (extractedParams?.error) {
          logger5.warn(
            `PROPOSE_GOVERNANCE_POLYGON: Model responded with error: ${extractedParams.error}`
          );
          throw new Error(extractedParams.error);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger5.warn(
          `PROPOSE_GOVERNANCE_POLYGON: Failed to parse JSON from model response or model returned error (Proceeding to manual extraction): ${errorMsg}`
        );
      }
      if (!extractedParams || extractedParams.error || !extractedParams.chain || !extractedParams.governorAddress || !extractedParams.targets || !extractedParams.values || !extractedParams.calldatas || !extractedParams.description) {
        logger5.info(
          "PROPOSE_GOVERNANCE_POLYGON: Model extraction insufficient, attempting manual parameter extraction from text."
        );
        const manualParams = extractProposeGovernanceParamsFromText(rawMessageText);
        if (extractedParams && !extractedParams.error) {
          extractedParams = {
            chain: extractedParams.chain || manualParams.chain,
            governorAddress: extractedParams.governorAddress || manualParams.governorAddress,
            targets: extractedParams.targets && extractedParams.targets.length > 0 ? extractedParams.targets : manualParams.targets,
            values: extractedParams.values && extractedParams.values.length > 0 ? extractedParams.values : manualParams.values,
            calldatas: extractedParams.calldatas && extractedParams.calldatas.length > 0 ? extractedParams.calldatas : manualParams.calldatas,
            description: extractedParams.description || manualParams.description
          };
        } else {
          extractedParams = manualParams;
        }
        logger5.debug(
          "PROPOSE_GOVERNANCE_POLYGON: Params after manual extraction attempt:",
          extractedParams
        );
      }
      if (!extractedParams?.chain || !extractedParams.governorAddress || !extractedParams.targets || !(extractedParams.targets.length > 0) || // Ensure targets is not empty
      !extractedParams.values || !(extractedParams.values.length > 0) || // Ensure values is not empty
      !extractedParams.calldatas || !(extractedParams.calldatas.length > 0) || // Ensure calldatas is not empty
      !extractedParams.description) {
        logger5.error(
          "PROPOSE_GOVERNANCE_POLYGON: Incomplete parameters after all extraction attempts.",
          extractedParams
        );
        throw new Error(
          "Incomplete or invalid proposal parameters extracted after all attempts. Required: chain, governorAddress, targets, values, calldatas, description."
        );
      }
      const proposeParams = extractedParams;
      logger5.debug("Propose governance parameters for runner:", proposeParams);
      const txResult = await actionRunner.propose(proposeParams);
      let successMsg = `Proposed governance action on ${proposeParams.chain} to ${proposeParams.governorAddress}. Desc: "${proposeParams.description}". TxHash: ${txResult.hash}.`;
      if (txResult.proposalId) {
        successMsg += ` Proposal ID: ${txResult.proposalId}`;
      }
      logger5.info(successMsg);
      if (callback) {
        await callback({
          text: successMsg,
          content: { success: true, ...txResult },
          actions: ["PROPOSE_GOVERNANCE_POLYGON"],
          source: message.content.source
        });
      }
      return { success: true, ...txResult };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger5.error("Error in PROPOSE_GOVERNANCE_POLYGON handler:", errMsg, error);
      if (callback) {
        await callback({
          text: `Error proposing governance action: ${errMsg}`,
          actions: ["PROPOSE_GOVERNANCE_POLYGON"],
          source: message.content.source
        });
      }
      return { success: false, error: errMsg };
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: 'Propose on polygon to governor 0x123 targets [0x456] values [0] calldatas [0x789] with description "Test proposal"'
        }
      },
      {
        name: "user",
        content: {
          text: "Create a new proposal. Chain: polygon. Governor: 0xabc. Targets: [0xdef]. Values: ['0']. Calldatas: ['0xghi']. Description: Hello world."
        }
      }
    ]
  ]
};

// src/actions/voteGovernance.ts
import {
  logger as logger6,
  composePromptFromState as composePromptFromState5,
  ModelType as ModelType5,
  parseJSONObjectFromText as parseJSONObjectFromText4
} from "@elizaos/core";
import { encodeFunctionData as encodeFunctionData2 } from "viem";
var governorVoteAbi = [
  {
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "support", type: "uint8" }
      // 0 = Against, 1 = For, 2 = Abstain
      // { name: 'reason', type: 'string' }, // For castVoteWithReason (optional)
    ],
    name: "castVote",
    // or castVoteWithReason
    outputs: [],
    // Typically returns a boolean success or nothing, tx receipt is key
    stateMutability: "nonpayable",
    type: "function"
  }
];
var governorVoteWithReasonAbi = [
  {
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "support", type: "uint8" },
      { name: "reason", type: "string" }
    ],
    name: "castVoteWithReason",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
function extractVoteGovernanceParamsFromText(text) {
  const params = {};
  logger6.debug(`Attempting to extract VoteGovernanceParams from text: "${text}"`);
  const chainMatch = text.match(/\b(?:on\s+|chain\s*[:\-]?\s*)(\w+)/i);
  if (chainMatch?.[1]) params.chain = chainMatch[1].toLowerCase();
  const governorMatch = text.match(/\b(?:governor\s*(?:address\s*)?[:\-]?\s*)(0x[a-fA-F0-9]{40})/i);
  if (governorMatch?.[1]) params.governorAddress = governorMatch[1];
  const proposalIdMatch = text.match(/\b(?:proposal\s*id|prop\s*id)\s*[:\-]?\s*([\w\d\-]+)/i);
  if (proposalIdMatch?.[1]) params.proposalId = proposalIdMatch[1];
  const supportForMatch = text.match(/\b(?:vote|support|option)\s*[:\-]?\s*(for|yes|aye)\b/i);
  const supportAgainstMatch = text.match(
    /\b(?:vote|support|option)\s*[:\-]?\s*(against|no|nay)\b/i
  );
  const supportAbstainMatch = text.match(/\b(?:vote|support|option)\s*[:\-]?\s*(abstain)\b/i);
  const supportNumericMatch = text.match(/\b(?:vote|support|option)\s*[:\-]?\s*([012])\b/i);
  if (supportForMatch) params.support = 1;
  else if (supportAgainstMatch) params.support = 0;
  else if (supportAbstainMatch) params.support = 2;
  else if (supportNumericMatch?.[1]) params.support = Number.parseInt(supportNumericMatch[1], 10);
  const reasonMatch = text.match(
    /\b(?:reason|rationale)\s*[:\-]?\s*(?:['"“](.+?)['"”]|(.+?)(?:\s*\b(?:chain|governor|proposalId|support)\b|$))/i
  );
  if (reasonMatch) {
    params.reason = (reasonMatch[1] || reasonMatch[2])?.trim();
  }
  logger6.debug("Manually extracted VoteGovernanceParams:", params);
  return params;
}
var PolygonVoteGovernanceActionRunner = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  async vote(params) {
    const walletClient = this.walletProvider.getWalletClient(params.chain);
    const publicClient = this.walletProvider.getPublicClient(params.chain);
    const chainConfig = this.walletProvider.getChainConfigs(params.chain);
    if (!walletClient.account) {
      throw new Error("Wallet client account is not available.");
    }
    const senderAddress = walletClient.account.address;
    const proposalIdBigInt = BigInt(params.proposalId);
    let txData;
    if (params.reason && params.reason.trim() !== "") {
      txData = encodeFunctionData2({
        abi: governorVoteWithReasonAbi,
        functionName: "castVoteWithReason",
        args: [proposalIdBigInt, params.support, params.reason]
      });
    } else {
      txData = encodeFunctionData2({
        abi: governorVoteAbi,
        functionName: "castVote",
        args: [proposalIdBigInt, params.support]
      });
    }
    try {
      logger6.debug(
        `Voting on chain ${params.chain}, governor ${params.governorAddress}, proposal ${params.proposalId}, support ${params.support}, reason: "${params.reason || ""}"`
      );
      const kzg = {
        blobToKzgCommitment: (_blob) => {
          throw new Error("KZG not impl.");
        },
        computeBlobKzgProof: (_blob, _commit) => {
          throw new Error("KZG not impl.");
        }
      };
      const hash = await walletClient.sendTransaction({
        account: senderAddress,
        to: params.governorAddress,
        value: BigInt(0),
        data: txData,
        chain: chainConfig,
        kzg
      });
      logger6.info(`Vote transaction sent. Hash: ${hash}. Waiting for receipt...`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      logger6.debug("Transaction receipt:", receipt);
      return {
        hash,
        from: senderAddress,
        to: params.governorAddress,
        value: BigInt(0),
        data: txData,
        chainId: chainConfig.id,
        logs: receipt.logs,
        proposalId: params.proposalId,
        support: params.support,
        reason: params.reason
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger6.error(`Governance vote failed: ${errMsg}`, error);
      throw new Error(`Governance vote failed: ${errMsg}`);
    }
  }
};
var voteGovernanceAction = {
  name: "VOTE_GOVERNANCE_POLYGON",
  similes: ["CAST_VOTE_POLYGON", "SUPPORT_PROPOSAL_POLYGON", "VOTE_ON_PROPOSAL_POLYGON"],
  description: "Casts a vote on a governance proposal using the Polygon WalletProvider.",
  validate: async (runtime) => {
    logger6.debug("Validating VOTE_GOVERNANCE_POLYGON action...");
    if (!runtime.getSetting("WALLET_PRIVATE_KEY") || !runtime.getSetting("POLYGON_PLUGINS_ENABLED")) {
      logger6.error(
        "Required settings (WALLET_PRIVATE_KEY, POLYGON_PLUGINS_ENABLED) are not configured."
      );
      return false;
    }
    try {
      await initWalletProvider(runtime);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger6.error(`WalletProvider initialization failed during validation: ${errMsg}`);
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _responses) => {
    logger6.info("Handling VOTE_GOVERNANCE_POLYGON for message:", message.id);
    const rawMessageText = message.content.text || "";
    let extractedParams = null;
    try {
      const walletProvider = await initWalletProvider(runtime);
      const actionRunner = new PolygonVoteGovernanceActionRunner(walletProvider);
      const prompt = composePromptFromState5({
        state,
        template: voteGovernanceActionTemplate
        // Use the new string template
      });
      const modelResponse = await runtime.useModel(ModelType5.TEXT_SMALL, {
        prompt
      });
      try {
        const parsed = parseJSONObjectFromText4(modelResponse);
        if (parsed) {
          extractedParams = parsed;
        }
        logger6.debug("VOTE_GOVERNANCE_POLYGON: Extracted params via TEXT_SMALL:", extractedParams);
        if (extractedParams?.error) {
          logger6.warn(
            `VOTE_GOVERNANCE_POLYGON: Model responded with error: ${extractedParams.error}`
          );
          throw new Error(extractedParams.error);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger6.warn(
          `VOTE_GOVERNANCE_POLYGON: Failed to parse JSON from model response or model returned error (Proceeding to manual extraction): ${errorMsg}`
        );
      }
      if (!extractedParams || extractedParams.error || !extractedParams.chain || !extractedParams.governorAddress || extractedParams.proposalId === void 0 || extractedParams.support === void 0) {
        logger6.info(
          "VOTE_GOVERNANCE_POLYGON: Model extraction insufficient or failed, attempting manual parameter extraction."
        );
        const manualParams = extractVoteGovernanceParamsFromText(rawMessageText);
        if (extractedParams && !extractedParams.error) {
          extractedParams = {
            chain: extractedParams.chain || manualParams.chain,
            governorAddress: extractedParams.governorAddress || manualParams.governorAddress,
            proposalId: extractedParams.proposalId || manualParams.proposalId,
            support: extractedParams.support !== void 0 ? extractedParams.support : manualParams.support,
            // Check for undefined explicitly for support
            reason: extractedParams.reason || manualParams.reason
          };
        } else {
          extractedParams = manualParams;
        }
        logger6.debug(
          "VOTE_GOVERNANCE_POLYGON: Params after manual extraction attempt:",
          extractedParams
        );
      }
      if (!extractedParams?.chain || !extractedParams.governorAddress || extractedParams.proposalId === void 0 || // Check for undefined
      typeof extractedParams.support !== "number" || // Check for number type and range
      ![0, 1, 2].includes(extractedParams.support)) {
        logger6.error(
          "VOTE_GOVERNANCE_POLYGON: Incomplete or invalid parameters after all extraction attempts.",
          extractedParams
        );
        throw new Error(
          "Incomplete or invalid vote parameters: chain, governorAddress, proposalId, and support (0, 1, or 2) are required."
        );
      }
      const voteParams = extractedParams;
      logger6.debug("Vote governance parameters for runner:", voteParams);
      const txResult = await actionRunner.vote(voteParams);
      const successMsg = `Successfully voted on proposal ${voteParams.proposalId} on chain ${voteParams.chain} for governor ${voteParams.governorAddress}. Support: ${voteParams.support}. TxHash: ${txResult.hash}.`;
      logger6.info(successMsg);
      if (callback) {
        await callback({
          text: successMsg,
          content: { success: true, ...txResult },
          actions: ["VOTE_GOVERNANCE_POLYGON"],
          source: message.content.source
        });
      }
      return { success: true, ...txResult };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger6.error("Error in VOTE_GOVERNANCE_POLYGON handler:", errMsg, error);
      if (callback) {
        await callback({
          text: `Error voting on proposal: ${errMsg}`,
          actions: ["VOTE_GOVERNANCE_POLYGON"],
          source: message.content.source
        });
      }
      return { success: false, error: errMsg };
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Vote FOR proposal 123 on Polygon governor 0xGov. Chain: polygon."
        }
      },
      {
        name: "user",
        content: {
          text: "Support proposal 0xPropId with option 1 on governor 0xGovAddress for ethereum chain."
        }
      }
    ]
  ]
};

// src/actions/getValidatorInfo.ts
import {
  logger as coreLogger,
  composePromptFromState as composePromptFromState6,
  ModelType as ModelType6
} from "@elizaos/core";
import { formatUnits as formatUnits3 } from "viem";
async function attemptParamExtraction(responseText) {
  coreLogger.debug("Raw responseText for extraction:", responseText);
  try {
    const jsonMatch = responseText.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
    if (jsonMatch?.[1]) {
      const params = JSON.parse(jsonMatch[1]);
      coreLogger.debug(`Extracted params from JSON code block: ${JSON.stringify(params)}`);
      return params;
    }
    if (responseText.trim().startsWith("{") && responseText.trim().endsWith("}")) {
      const params = JSON.parse(responseText.trim());
      coreLogger.debug(`Extracted params from plain JSON: ${JSON.stringify(params)}`);
      return params;
    }
  } catch (jsonError) {
    coreLogger.debug("Failed to parse as JSON, trying direct extraction");
  }
  const validatorPattern = /validator\s+(?:id\s+)?(\d+)|validator[^\d]*?(\d+)|validator.*?(\d+)/i;
  const validatorMatch = responseText.match(validatorPattern);
  coreLogger.debug("Validator match:", validatorMatch);
  if (validatorMatch) {
    const numberGroup = validatorMatch.slice(1).find((g) => g !== void 0);
    if (numberGroup) {
      const validatorId = Number.parseInt(numberGroup, 10);
      coreLogger.debug(`Extracted validatorId ${validatorId} from text pattern match`);
      return { validatorId };
    }
  }
  const anyNumberMatch = responseText.match(/\b(\d+)\b/);
  if (anyNumberMatch?.[1]) {
    const validatorId = Number.parseInt(anyNumberMatch[1], 10);
    coreLogger.debug(`Found potential validatorId ${validatorId} from text as last resort`);
    return { validatorId };
  }
  throw new ValidationError("Could not extract validator ID from response");
}
var getValidatorInfoAction = {
  name: "GET_VALIDATOR_INFO",
  similes: ["QUERY_VALIDATOR", "VALIDATOR_DETAILS", "GET_L1_VALIDATOR_INFO"],
  description: "Retrieves information about a specific Polygon validator.",
  validate: async (runtime, _message, _state) => {
    coreLogger.debug("Validating GET_VALIDATOR_INFO action...");
    const requiredSettings = [
      "PRIVATE_KEY",
      "ETHEREUM_RPC_URL",
      // L1 RPC needed for validator info
      "POLYGON_RPC_URL",
      // L2 RPC for completeness
      "POLYGON_PLUGINS_ENABLED"
    ];
    for (const setting of requiredSettings) {
      if (!runtime.getSetting(setting)) {
        coreLogger.error(
          `Required setting ${setting} not configured for GET_VALIDATOR_INFO action.`
        );
        return false;
      }
    }
    try {
      const service = runtime.getService(PolygonRpcService.serviceType);
      if (!service) {
        throw new ServiceError("PolygonRpcService not initialized", "PolygonRpcService");
      }
    } catch (error) {
      const errorMsg = parseErrorMessage(error);
      coreLogger.error("Error accessing PolygonRpcService during validation:", error);
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _responses) => {
    coreLogger.info("Handling GET_VALIDATOR_INFO action for message:", message.id);
    try {
      const polygonService = runtime.getService(PolygonRpcService.serviceType);
      if (!polygonService) {
        throw new ServiceError("PolygonRpcService not available", "PolygonRpcService");
      }
      const prompt = composePromptFromState6({
        state,
        template: getValidatorInfoTemplate
      });
      let params;
      try {
        try {
          params = await runtime.useModel(ModelType6.OBJECT_LARGE, {
            prompt
          });
          coreLogger.debug("[GET_VALIDATOR_INFO_ACTION] Parsed LLM parameters:", params);
          if (params.error) {
            throw new ValidationError(params.error);
          }
        } catch (error) {
          coreLogger.debug(
            "[GET_VALIDATOR_INFO_ACTION] OBJECT_LARGE model failed, falling back to TEXT_LARGE",
            error instanceof Error ? error : void 0
          );
          const responseText = await runtime.useModel(ModelType6.LARGE, {
            prompt
          });
          coreLogger.debug("[GET_VALIDATOR_INFO_ACTION] Raw text response from LLM:", responseText);
          params = await attemptParamExtraction(responseText);
        }
        if (params.validatorId === void 0) {
          throw new ValidationError("Validator ID parameter not extracted properly");
        }
        if (typeof params.validatorId !== "number" || params.validatorId <= 0) {
          throw new ValidationError(
            `Invalid validator ID: ${params.validatorId}. Must be a positive integer.`
          );
        }
        coreLogger.debug("Validator parameters:", params);
      } catch (error) {
        const errorMsg = parseErrorMessage(error);
        coreLogger.error(
          "Failed to parse LLM response for validator parameters:",
          error instanceof Error ? error.message : String(error),
          error
        );
        const errorContent = {
          text: formatErrorMessage(
            "Parameter extraction",
            "Could not understand validator parameters. Please provide a valid validator ID (number).",
            errorMsg.details || void 0
          ),
          actions: ["GET_VALIDATOR_INFO"],
          source: message.content?.source,
          data: {
            success: false,
            error: "Invalid validator ID parameter"
          },
          success: false
        };
        if (callback) {
          await callback(errorContent);
        }
        return errorContent;
      }
      try {
        const validatorInfo = await polygonService.getValidatorInfo(params.validatorId);
        if (!validatorInfo) {
          throw new ContractError(
            `Validator with ID ${params.validatorId} not found or is inactive.`,
            "STAKE_MANAGER_ADDRESS_L1",
            "validators"
          );
        }
        const statusLabels = {
          [0 /* Inactive */]: "Inactive",
          [1 /* Active */]: "Active",
          [2 /* Unbonding */]: "Unbonding",
          [3 /* Jailed */]: "Jailed"
        };
        const statusLabel = statusLabels[validatorInfo.status] || "Unknown";
        const totalStakeMatic = formatUnits3(validatorInfo.totalStake, 18);
        const responseMsg = `Validator #${params.validatorId} Info:
- Status: ${statusLabel}
- Total Staked: ${totalStakeMatic} MATIC
- Commission Rate: ${validatorInfo.commissionRate * 100}%
- Signer Address: ${validatorInfo.signerAddress}
- Contract Address: ${validatorInfo.contractAddress}`;
        coreLogger.info(`Retrieved validator info for validator ID ${params.validatorId}`);
        const responseContent = {
          text: responseMsg,
          actions: ["GET_VALIDATOR_INFO"],
          source: message.content.source,
          data: {
            validatorId: params.validatorId,
            validator: {
              ...validatorInfo,
              status: statusLabel,
              totalStake: validatorInfo.totalStake.toString(),
              totalStakeFormatted: totalStakeMatic,
              activationEpoch: validatorInfo.activationEpoch.toString(),
              deactivationEpoch: validatorInfo.deactivationEpoch.toString(),
              jailEndEpoch: validatorInfo.jailEndEpoch.toString(),
              lastRewardUpdateEpoch: validatorInfo.lastRewardUpdateEpoch.toString()
            }
          }
        };
        if (callback) {
          await callback(responseContent);
        }
        return responseContent;
      } catch (error) {
        const errorMsg = parseErrorMessage(error);
        coreLogger.error(
          `Error getting validator info: ${errorMsg.message}`,
          error instanceof Error ? error : void 0
        );
        const errorContent = {
          text: formatErrorMessage(
            "Validator info retrieval",
            `Failed to get validator #${params.validatorId} info from Ethereum L1`
          ),
          actions: ["GET_VALIDATOR_INFO"],
          source: message.content?.source,
          data: {
            success: false,
            error: `Failed to retrieve validator ${params.validatorId} info: ${errorMsg.message}`,
            STAKE_MANAGER_ADDRESS_L1: true,
            method: "validators"
          },
          success: false
        };
        if (callback) {
          await callback(errorContent);
        }
        return errorContent;
      }
    } catch (error) {
      const parsedErrorObj = parseErrorMessage(error);
      coreLogger.error(`Error in GET_VALIDATOR_INFO handler: ${parsedErrorObj.message}`);
      if (parsedErrorObj.details) {
        coreLogger.error(`Details: ${parsedErrorObj.details}`);
      }
      if (error instanceof Error) {
        coreLogger.error("Original error object for stack trace:", error);
      } else if (typeof error === "object" && error !== null) {
        if (!parsedErrorObj.details) {
          coreLogger.error("Raw error object (stringified):", JSON.stringify(error));
        }
      }
      const formattedError = formatErrorMessage(
        "GET_VALIDATOR_INFO",
        parsedErrorObj.message,
        parsedErrorObj.details || void 0
      );
      const errorContent = {
        text: `Error retrieving validator information: ${formattedError}`,
        actions: ["GET_VALIDATOR_INFO"],
        source: message.content.source,
        data: {
          success: false,
          error: formattedError
        },
        success: false
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Show details for Polygon validator 123"
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "What is the commission rate of validator ID 42?"
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "Tell me about validator #56 on Polygon"
        }
      }
    ]
  ]
};

// src/actions/getDelegatorInfo.ts
import {
  logger as coreLogger2,
  composePromptFromState as composePromptFromState7,
  ModelType as ModelType7
} from "@elizaos/core";
import { formatUnits as formatUnits4, Wallet as Wallet2 } from "ethers";
var getDelegatorInfoAction = {
  name: "GET_DELEGATOR_INFO",
  similes: ["QUERY_STAKE", "DELEGATOR_DETAILS", "GET_MY_STAKE", "GET_L1_DELEGATOR_INFO"],
  description: "Retrieves staking information for a specific delegator address (defaults to agent wallet).",
  validate: async (runtime, _message, _state) => {
    coreLogger2.debug("Validating GET_DELEGATOR_INFO action...");
    const requiredSettings = [
      "PRIVATE_KEY",
      "ETHEREUM_RPC_URL",
      "POLYGON_RPC_URL",
      "POLYGON_PLUGINS_ENABLED"
    ];
    for (const setting of requiredSettings) {
      if (!runtime.getSetting(setting)) {
        coreLogger2.error(
          `Required setting ${setting} not configured for GET_DELEGATOR_INFO action.`
        );
        return false;
      }
    }
    try {
      const service = runtime.getService(PolygonRpcService.serviceType);
      if (!service) {
        coreLogger2.error("PolygonRpcService not initialized.");
        return false;
      }
    } catch (error) {
      coreLogger2.error("Error accessing PolygonRpcService during validation:", error);
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _responses) => {
    coreLogger2.info("Handling GET_DELEGATOR_INFO action for message:", message.id);
    try {
      const polygonService = runtime.getService(PolygonRpcService.serviceType);
      if (!polygonService) {
        throw new ServiceError("PolygonRpcService not available", PolygonRpcService.serviceType);
      }
      const prompt = composePromptFromState7({
        state,
        template: getDelegatorInfoTemplate
      });
      let params;
      try {
        try {
          params = await runtime.useModel(ModelType7.OBJECT_LARGE, {
            prompt
          });
          coreLogger2.debug("[GET_DELEGATOR_INFO_ACTION] Parsed LLM parameters:", params);
          if (params.error) {
            coreLogger2.error("[GET_DELEGATOR_INFO_ACTION] LLM returned an error:", params.error);
            throw new ValidationError(params.error);
          }
        } catch (error) {
          coreLogger2.debug(
            "[GET_DELEGATOR_INFO_ACTION] OBJECT_LARGE model failed, falling back to TEXT_LARGE and manual parsing",
            error instanceof Error ? error : void 0
          );
          const textResponse = await runtime.useModel(ModelType7.LARGE, {
            prompt
          });
          coreLogger2.debug("[GET_DELEGATOR_INFO_ACTION] Raw text response from LLM:", textResponse);
          params = await extractParamsFromText2(textResponse);
        }
        if (typeof params.validatorId !== "number" || params.validatorId <= 0 || !Number.isInteger(params.validatorId)) {
          coreLogger2.error(
            "[GET_DELEGATOR_INFO_ACTION] Invalid or missing validatorId from LLM:",
            params.validatorId
          );
          throw new ValidationError(
            `Validator ID not found or invalid. Received: ${params.validatorId}. Please provide a positive integer. `
          );
        }
        const validatorId = params.validatorId;
        let delegatorAddress = params.delegatorAddress;
        if (!delegatorAddress) {
          const privateKey = runtime.getSetting("PRIVATE_KEY");
          if (!privateKey) {
            throw new ServiceError(
              "Private key not available to determine agent wallet address.",
              "PRIVATE_KEY"
            );
          }
          const wallet = new Wallet2(privateKey);
          delegatorAddress = wallet.address;
          coreLogger2.info(
            `[GET_DELEGATOR_INFO_ACTION] No delegatorAddress provided, using agent's wallet: ${delegatorAddress}`
          );
        }
        coreLogger2.info(
          `GET_DELEGATOR_INFO: Fetching info for V:${validatorId} / D:${delegatorAddress}...`
        );
        const delegatorInfo = await polygonService.getDelegatorInfo(validatorId, delegatorAddress);
        if (!delegatorInfo) {
          const notFoundMsg = `No delegation found for address ${delegatorAddress} with validator ID ${validatorId}.`;
          coreLogger2.warn(notFoundMsg);
          throw new ValidationError(notFoundMsg);
        }
        const delegatedMatic = formatUnits4(delegatorInfo.delegatedAmount, 18);
        const pendingRewardsMatic = formatUnits4(delegatorInfo.pendingRewards, 18);
        const responseMsg = `Delegation Info for address ${delegatorAddress} with validator ${validatorId}:
- Delegated Amount: ${delegatedMatic} MATIC
- Pending Rewards: ${pendingRewardsMatic} MATIC`;
        coreLogger2.info(`Retrieved delegator info for V:${validatorId} / D:${delegatorAddress}`);
        const responseContent = {
          text: responseMsg,
          actions: ["GET_DELEGATOR_INFO"],
          source: message.content.source,
          data: {
            validatorId,
            delegatorAddress,
            delegation: {
              delegatedAmount: delegatorInfo.delegatedAmount.toString(),
              delegatedAmountFormatted: delegatedMatic,
              pendingRewards: delegatorInfo.pendingRewards.toString(),
              pendingRewardsFormatted: pendingRewardsMatic
            },
            success: true
          },
          success: true
        };
        if (callback) {
          await callback(responseContent);
        }
        return responseContent;
      } catch (error) {
        const parsedErrorObj = parseErrorMessage(error);
        coreLogger2.error(
          "Error in GET_DELEGATOR_INFO handler:",
          parsedErrorObj.message,
          error instanceof Error ? error : parsedErrorObj
        );
        const formattedError = formatErrorMessage("GET_DELEGATOR_INFO", parsedErrorObj.message);
        const errorContent = {
          text: `Error retrieving delegator information: ${formattedError}`,
          actions: ["GET_DELEGATOR_INFO"],
          source: message.content.source,
          data: {
            success: false,
            error: formattedError
          },
          success: false
        };
        if (callback) {
          await callback(errorContent);
        }
        return errorContent;
      }
    } catch (error) {
      const parsedErrorObj = parseErrorMessage(error);
      coreLogger2.error(
        "Error in GET_DELEGATOR_INFO handler:",
        parsedErrorObj.message,
        error instanceof Error ? error : parsedErrorObj
      );
      const formattedError = formatErrorMessage(
        "GET_DELEGATOR_INFO",
        parsedErrorObj.message,
        parsedErrorObj.details || void 0
      );
      const errorContent = {
        text: `Error retrieving delegator information: ${formattedError}`,
        actions: ["GET_DELEGATOR_INFO"],
        source: message.content.source,
        data: {
          success: false,
          error: formattedError
        },
        success: false
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Show my delegation details for validator 123"
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "How much is address 0x1234... delegating to validator 42?"
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "Check my pending rewards from validator 56"
        }
      }
    ]
  ]
};
async function extractParamsFromText2(responseText) {
  coreLogger2.debug("Raw responseText:", responseText);
  try {
    const jsonMatch = responseText.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
    if (jsonMatch?.[1]) {
      const result = JSON.parse(jsonMatch[1]);
      coreLogger2.debug("Extracted from JSON block:", result);
      return result;
    }
    if (responseText.trim().startsWith("{") && responseText.trim().endsWith("}")) {
      const result = JSON.parse(responseText);
      coreLogger2.debug("Extracted from plain JSON:", result);
      return result;
    }
  } catch (jsonError) {
    coreLogger2.debug("Could not parse response as JSON", jsonError);
  }
  const validatorPattern = /validator\s+(?:id\s+)?(\d+)|validator[^\d]*?(\d+)|validator.*?(\d+)/i;
  const validatorMatch = responseText.match(validatorPattern);
  const addressPattern = /(0x[a-fA-F0-9]{40})/i;
  const addressMatch = responseText.match(addressPattern);
  coreLogger2.debug("Validator match:", validatorMatch);
  coreLogger2.debug("Address match:", addressMatch);
  const params = {};
  if (validatorMatch) {
    const numberGroup = validatorMatch.slice(1).find((g) => g !== void 0);
    if (numberGroup) {
      params.validatorId = Number.parseInt(numberGroup, 10);
      coreLogger2.debug(`Extracted validatorId ${params.validatorId} from text`);
    }
  }
  if (addressMatch?.[1]) {
    params.delegatorAddress = addressMatch[1];
    coreLogger2.debug(`Extracted delegatorAddress ${params.delegatorAddress} from text`);
  }
  if (params.validatorId) {
    return params;
  }
  const anyNumberMatch = responseText.match(/\b(\d+)\b/);
  if (anyNumberMatch?.[1]) {
    const potentialId = Number.parseInt(anyNumberMatch[1], 10);
    coreLogger2.debug(`Extracted potential validatorId ${potentialId} from text as last resort`);
    return { validatorId: potentialId };
  }
  return {
    error: "Could not extract validator ID from the response. Please provide a valid validator ID."
  };
}

// src/actions/withdrawRewardsL1.ts
import {
  logger as logger7,
  composePromptFromState as composePromptFromState8,
  ModelType as ModelType8,
  parseJSONObjectFromText as parseJSONObjectFromText5
} from "@elizaos/core";
function extractParamsFromText3(text) {
  const params = {};
  const validatorIdMatch = text.match(/validator(?: id)?\\s*[:#]?\\s*(\\d+)/i);
  if (validatorIdMatch?.[1]) {
    const id = Number.parseInt(validatorIdMatch[1], 10);
    if (id > 0) {
      params.validatorId = id;
    }
  }
  return params;
}
var withdrawRewardsAction = {
  name: "WITHDRAW_REWARDS_L1",
  similes: ["CLAIM_L1_STAKING_REWARDS", "COLLECT_VALIDATOR_REWARDS_L1"],
  description: "Withdraws accumulated staking rewards from a Polygon validator on Ethereum L1.",
  validate: async (runtime, _message, _state) => {
    logger7.debug("Validating WITHDRAW_REWARDS_L1 action...");
    const requiredSettings = [
      "PRIVATE_KEY",
      "ETHEREUM_RPC_URL",
      // L1 RPC needed for rewards withdrawal
      "POLYGON_PLUGINS_ENABLED"
    ];
    for (const setting of requiredSettings) {
      if (!runtime.getSetting(setting)) {
        logger7.error(`Required setting ${setting} not configured for WITHDRAW_REWARDS_L1 action.`);
        return false;
      }
    }
    try {
      const service = runtime.getService(PolygonRpcService.serviceType);
      if (!service) {
        logger7.error("PolygonRpcService not initialized for WITHDRAW_REWARDS_L1.");
        return false;
      }
    } catch (error) {
      logger7.error(
        "Error accessing PolygonRpcService during WITHDRAW_REWARDS_L1 validation:",
        error
      );
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _recentMessages) => {
    logger7.info("Handling WITHDRAW_REWARDS_L1 action for message:", message.id);
    const rawMessageText = message.content.text || "";
    let params = null;
    try {
      const polygonService = runtime.getService(PolygonRpcService.serviceType);
      if (!polygonService) {
        throw new Error("PolygonRpcService not available");
      }
      const prompt = composePromptFromState8({
        state,
        template: withdrawRewardsTemplate
      });
      try {
        const result = await runtime.useModel(ModelType8.TEXT_SMALL, {
          prompt
        });
        params = parseJSONObjectFromText5(result);
        logger7.debug("WITHDRAW_REWARDS_L1: Extracted params via TEXT_SMALL:", params);
        if (params.error) {
          logger7.warn(`WITHDRAW_REWARDS_L1: Model responded with error: ${params.error}`);
          throw new Error(params.error);
        }
      } catch (e) {
        logger7.warn(
          "WITHDRAW_REWARDS_L1: Failed to parse JSON from model response, trying manual extraction",
          e
        );
        const manualParams = extractParamsFromText3(rawMessageText);
        if (manualParams.validatorId) {
          params = {
            validatorId: manualParams.validatorId
          };
          logger7.debug("WITHDRAW_REWARDS_L1: Extracted params via manual text parsing:", params);
        } else {
          throw new Error("Could not determine validator ID from the message.");
        }
      }
      if (!params?.validatorId) {
        throw new Error("Validator ID is missing after extraction attempts.");
      }
      const { validatorId } = params;
      logger7.debug(`WITHDRAW_REWARDS_L1 parameters: validatorId: ${validatorId}`);
      const txHash = await polygonService.withdrawRewards(validatorId);
      const successMsg = `Successfully initiated withdrawal of rewards from validator ${validatorId} on L1. Transaction hash: ${txHash}`;
      logger7.info(successMsg);
      const responseContent = {
        text: successMsg,
        actions: ["WITHDRAW_REWARDS_L1"],
        source: message.content.source,
        data: {
          transactionHash: txHash,
          status: "pending",
          validatorId
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } catch (error) {
      const parsedError = parseErrorMessage(error);
      logger7.error("Error in WITHDRAW_REWARDS_L1 handler:", parsedError);
      const errorContent = {
        text: `Error withdrawing rewards: ${parsedError.message}`,
        actions: ["WITHDRAW_REWARDS_L1"],
        source: message.content.source,
        data: {
          success: false,
          error: parsedError.message,
          details: parsedError.details
        }
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Withdraw my staking rewards from validator 123"
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "Claim rewards from Polygon validator ID 42"
        }
      }
    ]
  ]
};

// src/actions/bridgeDeposit.ts
import {
  logger as logger8,
  composePromptFromState as composePromptFromState9,
  ModelType as ModelType9,
  parseJSONObjectFromText as parseJSONObjectFromText6
} from "@elizaos/core";
import {
  createConfig,
  executeRoute,
  getRoutes
} from "@lifi/sdk";
import {
  parseUnits as parseUnits4,
  parseAbi
} from "viem";
import { EVM } from "@lifi/sdk";
var tokenDecimalsAbi = parseAbi(["function decimals() view returns (uint8)"]);
var PolygonBridgeActionRunner = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
    const extendedChains = Object.values(this.walletProvider.chains).map((chainConfig) => {
      const rpcUrls = chainConfig.rpcUrls.custom?.http || chainConfig.rpcUrls.default.http;
      const blockExplorerUrl = chainConfig.blockExplorers?.default?.url || "";
      return {
        ...chainConfig,
        key: chainConfig.name.toLowerCase().replace(/\s+/g, "-"),
        chainType: "EVM",
        coin: chainConfig.nativeCurrency.symbol,
        mainnet: !chainConfig.testnet,
        logoURI: "",
        diamondAddress: void 0,
        nativeToken: {
          address: "0x0000000000000000000000000000000000000000",
          chainId: chainConfig.id,
          symbol: chainConfig.nativeCurrency.symbol,
          decimals: chainConfig.nativeCurrency.decimals,
          name: chainConfig.nativeCurrency.name,
          priceUSD: "0",
          logoURI: "",
          coinKey: chainConfig.nativeCurrency.symbol
        },
        metamask: {
          chainId: `0x${chainConfig.id.toString(16)}`,
          blockExplorerUrls: blockExplorerUrl ? [blockExplorerUrl] : [],
          chainName: chainConfig.name,
          nativeCurrency: chainConfig.nativeCurrency,
          rpcUrls: rpcUrls.slice()
        }
      };
    });
    const evmProvider = EVM({
      // Type mismatch with LiFi SDK typings is an issue, using 'as any' as a workaround
      // This is related to a complex intersection type conflict with the Client type
      getWalletClient: async () => this.walletProvider.getActiveWalletClient(),
      switchChain: async (chainId) => this.walletProvider.switchChainById(chainId)
    });
    this.config = createConfig({
      integrator: "ElizaOS-PolygonPlugin",
      chains: extendedChains,
      providers: [evmProvider]
      // ⬅ crucial line
    });
  }
  async getTokenDecimals(chainName, tokenAddress) {
    if (tokenAddress.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" || tokenAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      return this.walletProvider.getChainConfigs(chainName).nativeCurrency.decimals;
    }
    const publicClient = this.walletProvider.getPublicClient(chainName);
    try {
      return await publicClient.readContract({
        address: tokenAddress,
        abi: tokenDecimalsAbi,
        functionName: "decimals"
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger8.warn(
        `Could not fetch decimals for ${tokenAddress} on ${chainName}, defaulting to 18. Error: ${errorMessage}`
      );
      return 18;
    }
  }
  /**
   * Helper function to execute a bridge route and immediately return the tx hash
   * @param route The route to execute
   * @param onTxHash Callback for when the tx hash is available
   * @param onDone Callback for when the bridge is complete
   */
  async bridgeAndStream(route, onTxHash, onDone, onError) {
    let txHashSent = false;
    try {
      await executeRoute(route, {
        // Fires on every status change through updateRouteHook
        updateRouteHook: (updatedRoute) => {
          for (const step of updatedRoute.steps) {
            if (step.execution?.process) {
              for (const process2 of step.execution.process) {
                const hash = process2.txHash;
                if (!txHashSent && hash) {
                  txHashSent = true;
                  logger8.info(`Bridge transaction hash available: ${hash}`);
                  onTxHash(hash);
                }
              }
            }
          }
          const isComplete = updatedRoute.steps.every(
            (step) => step.execution?.status === "DONE" || step.execution?.status === "FAILED"
          );
          if (isComplete && onDone) {
            logger8.info(`Bridge operation completed`);
            onDone(updatedRoute);
          }
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger8.error("Bridge execution error:", err);
      if (onError) {
        onError(err);
      }
    }
  }
  async bridge(params) {
    logger8.debug("Available chains in WalletProvider:", Object.keys(this.walletProvider.chains));
    logger8.debug(`Attempting to get wallet client for chain: ${params.fromChain}`);
    const walletClient = this.walletProvider.getWalletClient(params.fromChain);
    const [fromAddress] = await walletClient.getAddresses();
    const fromTokenDecimals = await this.getTokenDecimals(params.fromChain, params.fromToken);
    const amountRaw = parseUnits4(params.amount, fromTokenDecimals).toString();
    logger8.debug(
      `Converted ${params.amount} tokens to ${amountRaw} base units using ${fromTokenDecimals} decimals`
    );
    const fromChainId = this.walletProvider.getChainConfigs(params.fromChain).id;
    const toChainId = this.walletProvider.getChainConfigs(params.toChain).id;
    const routeRequest = {
      fromChainId,
      toChainId,
      fromTokenAddress: params.fromToken,
      toTokenAddress: params.toToken,
      fromAmount: amountRaw,
      fromAddress,
      toAddress: params.toAddress || fromAddress
    };
    logger8.debug("Requesting bridge routes with:", routeRequest);
    try {
      const routes = await getRoutes(routeRequest);
      if (!routes.routes || routes.routes.length === 0) {
        logger8.error("No routes found for this bridge transaction");
        throw new Error("No routes found for bridging tokens between these chains");
      }
      logger8.debug(`Found ${routes.routes.length} routes, using the best route`);
      const bestRoute = routes.routes[0];
      logger8.debug("Best route selected:", JSON.stringify(bestRoute, null, 2));
      if (bestRoute.steps[0]?.estimate?.gasCosts) {
        logger8.debug(
          "Estimated gas costs:",
          JSON.stringify(bestRoute.steps[0].estimate.gasCosts, null, 2)
        );
      }
      if (bestRoute.steps[0]?.estimate?.feeCosts) {
        logger8.debug(
          "Estimated fee costs:",
          JSON.stringify(bestRoute.steps[0].estimate.feeCosts, null, 2)
        );
      }
      logger8.debug("Executing bridge route");
      const txHashPromise = new Promise((resolve, reject) => {
        this.bridgeAndStream(
          bestRoute,
          // Called as soon as the hash is available
          (hash) => {
            resolve(hash);
          },
          // Called when the bridge is complete (optional)
          (execution) => {
            logger8.info(`Bridge operation completed`);
          },
          // Error handler
          (error) => {
            logger8.error(`Bridge operation failed:`, error);
            reject(error);
          }
        );
      });
      try {
        const txHash = await txHashPromise;
        logger8.info(`Returning bridge transaction hash: ${txHash}`);
        const isNativeToken = params.fromToken.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" || params.fromToken.toLowerCase() === "0x0000000000000000000000000000000000000000";
        const txValue = isNativeToken ? parseUnits4(params.amount, fromTokenDecimals) : BigInt(0);
        const tx = {
          hash: txHash,
          from: fromAddress,
          to: bestRoute.steps[0].estimate.approvalAddress,
          value: txValue.toString(),
          valueRaw: txValue,
          chainId: fromChainId
        };
        const txForLog = { ...tx, valueRaw: tx.valueRaw.toString() };
        logger8.debug("Returning transaction:", JSON.stringify(txForLog, null, 2));
        return tx;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger8.error(`Bridge transaction hash retrieval failed: ${errorMessage}`, error);
        return {
          hash: "0x0",
          // A placeholder hash indicating failure
          from: fromAddress,
          to: bestRoute.steps[0].estimate.approvalAddress,
          value: "0",
          chainId: fromChainId,
          error: errorMessage
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger8.error(`Bridge transaction failed: ${errorMessage}`, error);
      return {
        hash: "0x0",
        // A placeholder hash indicating failure
        from: "0x0",
        to: "0x0",
        value: "0",
        chainId: 0,
        error: errorMessage
      };
    }
  }
};
var bridgeDepositAction = {
  name: "BRIDGE_DEPOSIT_POLYGON",
  similes: ["POLYGON_BRIDGE_FUNDS", "MOVE_ETH_TO_POLYGON_LIFI"],
  description: "Initiates a deposit/bridge using LiFi.",
  validate: async (runtime, _m, _s) => {
    logger8.debug("Validating BRIDGE_DEPOSIT_POLYGON...");
    const checks = [
      runtime.getSetting("WALLET_PRIVATE_KEY"),
      runtime.getSetting("POLYGON_PLUGINS_ENABLED")
    ];
    if (checks.some((check) => !check)) {
      logger8.error("Required settings (WALLET_PRIVATE_KEY, POLYGON_PLUGINS_ENABLED) missing.");
      return false;
    }
    try {
      await initWalletProvider(runtime);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger8.error(`WalletProvider initialization failed during validation: ${errMsg} `);
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _o, cb, _rs) => {
    logger8.info("Handling BRIDGE_DEPOSIT_POLYGON for:", message.id);
    try {
      const walletProvider = await initWalletProvider(runtime);
      const actionRunner = new PolygonBridgeActionRunner(walletProvider);
      const prompt = composePromptFromState9({
        state,
        template: bridgeDepositPolygonTemplate
      });
      const modelResponse = await runtime.useModel(ModelType9.TEXT_SMALL, {
        prompt
      });
      let paramsJson;
      let bridgeOptions;
      try {
        paramsJson = parseJSONObjectFromText6(modelResponse);
        logger8.debug("Bridge parameters extracted:", paramsJson);
        if ("error" in paramsJson) {
          logger8.warn(`Bridge action: Model responded with error: ${paramsJson.error}`);
          throw new Error(paramsJson.error);
        }
        bridgeOptions = paramsJson;
      } catch (e) {
        logger8.error("Failed to parse LLM response for bridge params:", modelResponse, e);
        throw new Error("Could not understand bridge parameters.");
      }
      if (!bridgeOptions.fromChain || !bridgeOptions.toChain || !bridgeOptions.fromToken || !bridgeOptions.toToken || !bridgeOptions.amount) {
        throw new Error("Incomplete bridge parameters extracted.");
      }
      logger8.debug("Parsed bridge options:", bridgeOptions);
      const bridgeResp = await actionRunner.bridge(bridgeOptions);
      if (bridgeResp.error) {
        logger8.error("Bridge operation failed:", bridgeResp.error);
        throw new Error(bridgeResp.error);
      }
      const fromChainFormatted = bridgeOptions.fromChain.charAt(0).toUpperCase() + bridgeOptions.fromChain.slice(1);
      const toChainFormatted = bridgeOptions.toChain.charAt(0).toUpperCase() + bridgeOptions.toChain.slice(1);
      const successMessage = `
Bridging started! \u{1F680}
Initiating transfer of ${bridgeOptions.amount} tokens from ${fromChainFormatted} to ${toChainFormatted}.
Transaction hash: ${bridgeResp.hash}

The bridge operation is now in progress and will continue in the background. This may take several minutes to complete. You can check the status by tracking the transaction hash.`;
      logger8.info(`Bridge transaction initiated: ${bridgeResp.hash}`);
      if (cb) {
        await cb({
          text: successMessage,
          content: {
            success: true,
            hash: bridgeResp.hash,
            status: "pending",
            fromChain: bridgeOptions.fromChain,
            toChain: bridgeOptions.toChain,
            amount: bridgeOptions.amount
          },
          actions: ["BRIDGE_DEPOSIT_POLYGON"],
          source: message.content.source
        });
      }
      return {
        success: true,
        hash: bridgeResp.hash,
        status: "pending",
        fromChain: bridgeOptions.fromChain,
        toChain: bridgeOptions.toChain,
        amount: bridgeOptions.amount
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger8.error("BRIDGE_DEPOSIT_POLYGON handler error:", errMsg, error);
      if (cb) {
        await cb({
          text: `Error bridging: ${errMsg}`,
          actions: ["BRIDGE_DEPOSIT_POLYGON"],
          source: message.content.source
        });
      }
      return { success: false, error: errMsg };
    }
  },
  examples: [
    [
      {
        name: "user",
        content: { text: "Bridge 0.5 WETH from Polygon to Ethereum mainnet." }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "Move 100 USDC from Arbitrum to Polygon, send it to 0x123..."
        }
      }
    ]
  ]
};

// src/actions/getL2BlockNumber.ts
import {
  logger as logger9
} from "@elizaos/core";
var getL2BlockNumberAction = {
  name: "GET_L2_BLOCK_NUMBER",
  similes: ["GET_POLYGON_BLOCK_NUMBER", "CHECK_CURRENT_BLOCK", "SHOW_LATEST_BLOCK"],
  description: "Gets the current block number on Polygon (L2).",
  validate: async (runtime, message, state) => {
    const content = message.content?.text?.toLowerCase() || "";
    logger9.info(`[getL2BlockNumberAction] Validating message: "${content}"`);
    const blockNumberKeywords = [
      "block number",
      "current block",
      "latest block",
      "polygon block number",
      "get polygon block",
      "block height",
      "current polygon block",
      "latest polygon block",
      "get polygon block number",
      "show polygon block number"
    ];
    const matches = blockNumberKeywords.some((keyword) => content.includes(keyword));
    logger9.info(`[getL2BlockNumberAction] Validation result: ${matches}`);
    return matches;
  },
  handler: async (runtime, message, state, options, callback) => {
    logger9.info("[getL2BlockNumberAction] Handler called!");
    const rpcService = runtime.getService(PolygonRpcService.serviceType);
    if (!rpcService) {
      throw new Error("PolygonRpcService not available");
    }
    try {
      const blockNumber = await rpcService.getCurrentBlockNumber();
      const responseContent = {
        text: `The current Polygon block number is ${blockNumber}.`,
        actions: ["GET_L2_BLOCK_NUMBER"],
        data: {
          blockNumber,
          network: "polygon",
          timestamp: Date.now()
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } catch (error) {
      logger9.error("Error getting L2 block number:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorContent = {
        text: `Error retrieving current Polygon block number: ${errorMessage}`,
        actions: ["GET_L2_BLOCK_NUMBER"],
        data: { error: errorMessage }
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "get polygon block number"
        }
      },
      {
        name: "assistant",
        content: {
          text: "The current Polygon block number is 65123456.",
          actions: ["GET_L2_BLOCK_NUMBER"]
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "what is the current block number on polygon?"
        }
      },
      {
        name: "assistant",
        content: {
          text: "The current Polygon block number is 65123456.",
          actions: ["GET_L2_BLOCK_NUMBER"]
        }
      }
    ]
  ]
};

// src/actions/getMaticBalance.ts
import {
  logger as logger10,
  elizaLogger as elizaLogger3
} from "@elizaos/core";
import { ethers as ethers3 } from "ethers";
var getMaticBalanceAction = {
  name: "GET_MATIC_BALANCE",
  similes: ["CHECK_MATIC_BALANCE", "SHOW_POLYGON_BALANCE", "GET_NATIVE_BALANCE"],
  description: "Gets the MATIC balance for the agent's address on Polygon (L2).",
  validate: async (runtime, message, state) => {
    const content = message.content?.text?.toLowerCase() || "";
    logger10.info(`[getMaticBalanceAction] VALIDATION CALLED - message: "${content}"`);
    try {
      const maticBalanceKeywords = [
        "matic balance",
        "get matic balance",
        "show matic balance",
        "check matic balance",
        "my matic balance",
        "polygon balance",
        "balance on polygon",
        "how much matic",
        "matic amount",
        "show me my matic",
        "what is my matic balance",
        "check my matic"
      ];
      const matches = maticBalanceKeywords.some((keyword) => content.includes(keyword));
      logger10.info(
        `[getMaticBalanceAction] Validation result: ${matches} (keywords checked: ${maticBalanceKeywords.length})`
      );
      const rpcService = runtime.getService(PolygonRpcService.serviceType);
      if (!rpcService) {
        logger10.warn(`[getMaticBalanceAction] PolygonRpcService not available - validation false`);
        return false;
      }
      return matches;
    } catch (error) {
      logger10.error(`[getMaticBalanceAction] Validation error:`, error);
      return false;
    }
  },
  handler: async (runtime, message, state, options, callback) => {
    logger10.info("[getMaticBalanceAction] Handler called!");
    const rpcService = runtime.getService(PolygonRpcService.serviceType);
    if (!rpcService) throw new Error("PolygonRpcService not available");
    try {
      const polygonWalletProvider2 = await initWalletProvider(runtime);
      if (!polygonWalletProvider2) {
        throw new Error(
          "Failed to initialize PolygonWalletProvider - check that PRIVATE_KEY is configured correctly"
        );
      }
      const agentAddress = polygonWalletProvider2.getAddress();
      if (!agentAddress) throw new Error("Could not determine agent address from provider");
      logger10.info(`Fetching MATIC balance for address: ${agentAddress}`);
      const balanceWei = await rpcService.getBalance(agentAddress, "L2");
      elizaLogger3.info(`Balance: ${balanceWei}`);
      const balanceMatic = ethers3.formatEther(balanceWei);
      const responseContent = {
        text: `Your MATIC balance (${agentAddress}): ${balanceMatic} MATIC`,
        actions: ["GET_MATIC_BALANCE"],
        data: {
          address: agentAddress,
          balanceWei: balanceWei.toString(),
          balanceMatic
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } catch (error) {
      logger10.error("Error getting MATIC balance:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const userMessage = errorMessage.includes("private key") ? "There was an issue with the wallet configuration. Please ensure PRIVATE_KEY is correctly set." : `Error retrieving MATIC balance: ${errorMessage}`;
      const errorContent = {
        text: userMessage,
        actions: ["GET_MATIC_BALANCE"],
        data: { error: errorMessage }
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "get matic balance"
        }
      },
      {
        name: "assistant",
        content: {
          text: "Your MATIC balance (0x1234...): 17.856183245623432226 MATIC",
          actions: ["GET_MATIC_BALANCE"]
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "what is my polygon balance?"
        }
      },
      {
        name: "assistant",
        content: {
          text: "Your MATIC balance (0x1234...): 17.856183245623432226 MATIC",
          actions: ["GET_MATIC_BALANCE"]
        }
      }
    ]
  ]
};

// src/actions/getPolygonGasEstimates.ts
var getPolygonGasEstimatesAction = {
  name: "GET_POLYGON_GAS_ESTIMATES",
  description: "Gets current gas price estimates for Polygon from PolygonScan.",
  validate: async () => true,
  handler: async (runtime) => {
    const estimates = await getGasPriceEstimates(runtime);
    let text = "Polygon Gas Estimates (Wei):\n";
    text += `  Safe Low Priority: ${estimates.safeLow?.maxPriorityFeePerGas?.toString() ?? "N/A"}
`;
    text += `  Average Priority:  ${estimates.average?.maxPriorityFeePerGas?.toString() ?? "N/A"}
`;
    text += `  Fast Priority:     ${estimates.fast?.maxPriorityFeePerGas?.toString() ?? "N/A"}
`;
    text += `  Estimated Base:  ${estimates.estimatedBaseFee?.toString() ?? "N/A"}`;
    if (estimates.fallbackGasPrice) {
      text += `
  (Used Fallback Price: ${estimates.fallbackGasPrice.toString()})`;
    }
    const serializableEstimates = {
      safeLow: estimates.safeLow ? {
        maxPriorityFeePerGas: estimates.safeLow.maxPriorityFeePerGas ? estimates.safeLow.maxPriorityFeePerGas.toString() : null
      } : null,
      average: estimates.average ? {
        maxPriorityFeePerGas: estimates.average.maxPriorityFeePerGas ? estimates.average.maxPriorityFeePerGas.toString() : null
      } : null,
      fast: estimates.fast ? {
        maxPriorityFeePerGas: estimates.fast.maxPriorityFeePerGas ? estimates.fast.maxPriorityFeePerGas.toString() : null
      } : null,
      estimatedBaseFee: estimates.estimatedBaseFee ? estimates.estimatedBaseFee.toString() : null,
      fallbackGasPrice: estimates.fallbackGasPrice ? estimates.fallbackGasPrice.toString() : null
    };
    return {
      text,
      actions: ["GET_POLYGON_GAS_ESTIMATES"],
      data: serializableEstimates
    };
  },
  examples: [
    [
      {
        name: "User",
        content: { text: "What are the current gas prices on Polygon?" }
      }
    ],
    [
      {
        name: "User",
        content: { text: "Get Polygon gas estimates" }
      }
    ],
    [
      {
        name: "User",
        content: { text: "Fetch gas fees for Polygon network" }
      }
    ]
  ]
};

// src/actions/undelegateL1.ts
import {
  logger as logger11,
  composePromptFromState as composePromptFromState10,
  ModelType as ModelType10,
  parseJSONObjectFromText as parseJSONObjectFromText7
} from "@elizaos/core";
import { parseUnits as parseUnits5 } from "ethers";

// src/utils.ts
function parseBigIntString(value, unitName) {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
    throw new Error(`Invalid ${unitName} amount: Must be a string representing an integer.`);
  }
  try {
    return BigInt(value);
  } catch (e) {
    throw new Error(`Invalid ${unitName} amount: Cannot parse '${value}' as BigInt.`);
  }
}

// src/actions/undelegateL1.ts
function extractParamsFromText4(text) {
  const params = {};
  const validatorIdMatch = text.match(/validator(?: id)?\\s*[:#]?\\s*(\\d+)/i);
  if (validatorIdMatch?.[1]) {
    const id = Number.parseInt(validatorIdMatch[1], 10);
    if (id > 0) {
      params.validatorId = id;
    }
  }
  const sharesMatch = text.match(/(\\d*\\.?\\d+)\\s*(?:shares?|validator shares?)?/i);
  if (sharesMatch?.[1]) {
    try {
      params.sharesAmountWei = parseUnits5(sharesMatch[1], 18).toString();
    } catch (e) {
      logger11.warn(`Could not parse shares amount from text: ${sharesMatch[1]}`, e);
    }
  }
  return params;
}
var undelegateL1Action = {
  name: "UNDELEGATE_L1",
  similes: ["UNSTAKE_L1_SHARES", "UNBOND_VALIDATOR_SHARES_L1", "SELL_VALIDATOR_SHARES_L1"],
  description: "Initiates undelegation (unbonding) of Validator Shares from a Polygon validator on Ethereum L1.",
  validate: async (runtime, _message, _state) => {
    logger11.debug("Validating UNDELEGATE_L1 action...");
    const requiredSettings = [
      "PRIVATE_KEY",
      "ETHEREUM_RPC_URL",
      // L1 RPC needed for undelegation
      "POLYGON_PLUGINS_ENABLED"
      // Ensure main plugin toggle is on
    ];
    for (const setting of requiredSettings) {
      if (!runtime.getSetting(setting)) {
        logger11.error(`Required setting ${setting} not configured for UNDELEGATE_L1 action.`);
        return false;
      }
    }
    try {
      const service = runtime.getService(PolygonRpcService.serviceType);
      if (!service) {
        logger11.error("PolygonRpcService not initialized for UNDELEGATE_L1.");
        return false;
      }
    } catch (error) {
      logger11.error("Error accessing PolygonRpcService during UNDELEGATE_L1 validation:", error);
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _recentMessages) => {
    logger11.info("Handling UNDELEGATE_L1 action for message:", message.id);
    const rawMessageText = message.content.text || "";
    let params = null;
    try {
      const rpcService = runtime.getService(PolygonRpcService.serviceType);
      if (!rpcService) {
        throw new Error("PolygonRpcService not available");
      }
      const prompt = composePromptFromState10({
        state,
        template: undelegateL1Template
      });
      try {
        const result = await runtime.useModel(ModelType10.TEXT_SMALL, {
          prompt
        });
        params = parseJSONObjectFromText7(result);
        logger11.debug("UNDELEGATE_L1: Extracted params via TEXT_SMALL:", params);
        if (params.error) {
          logger11.warn(`UNDELEGATE_L1: Model responded with error: ${params.error}`);
          throw new Error(params.error);
        }
      } catch (e) {
        logger11.warn(
          "UNDELEGATE_L1: Failed to parse JSON from model response, trying manual extraction",
          e
        );
        const manualParams = extractParamsFromText4(rawMessageText);
        if (manualParams.validatorId && manualParams.sharesAmountWei) {
          params = {
            validatorId: manualParams.validatorId,
            sharesAmountWei: manualParams.sharesAmountWei
          };
          logger11.debug("UNDELEGATE_L1: Extracted params via manual text parsing:", params);
        } else {
          throw new Error("Could not determine validator ID or shares amount from the message.");
        }
      }
      if (!params?.validatorId || !params.sharesAmountWei) {
        throw new Error("Validator ID or shares amount is missing after extraction attempts.");
      }
      const { validatorId, sharesAmountWei } = params;
      logger11.debug(
        `UNDELEGATE_L1 parameters: validatorId: ${validatorId}, sharesAmountWei: ${sharesAmountWei}`
      );
      const sharesAmountBigInt = parseBigIntString(sharesAmountWei, "shares");
      const txHash = await rpcService.undelegate(validatorId, sharesAmountBigInt);
      const successMsg = `Undelegation transaction sent to L1: ${txHash}. Unbonding period applies.`;
      logger11.info(successMsg);
      const responseContent = {
        text: successMsg,
        actions: ["UNDELEGATE_L1"],
        source: message.content.source,
        data: {
          transactionHash: txHash,
          status: "pending",
          validatorId,
          sharesAmountWei
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } catch (error) {
      const parsedError = parseErrorMessage(error);
      logger11.error("Error in UNDELEGATE_L1 handler:", parsedError);
      const errorContent = {
        text: `Error undelegating shares (L1): ${parsedError.message}`,
        actions: ["UNDELEGATE_L1"],
        source: message.content.source,
        data: {
          success: false,
          error: parsedError.message,
          details: parsedError.details
        }
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "I want to undelegate 10 shares from validator 123 on L1"
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "Unstake 5.5 validator shares from the Polygon validator ID 42"
        }
      }
    ]
  ]
};

// src/actions/restakeRewardsL1.ts
import {
  logger as logger12,
  composePromptFromState as composePromptFromState11,
  ModelType as ModelType11,
  parseJSONObjectFromText as parseJSONObjectFromText8
} from "@elizaos/core";
function extractParamsFromText5(text) {
  const params = {};
  const validatorIdMatch = text.match(/validator(?: id)?\s*[:#]?\s*(\d+)/i);
  if (validatorIdMatch?.[1]) {
    const id = Number.parseInt(validatorIdMatch[1], 10);
    if (id > 0) {
      params.validatorId = id;
    }
  }
  return params;
}
var restakeRewardsL1Action = {
  name: "RESTAKE_REWARDS_L1",
  similes: ["COMPOUND_L1_REWARDS", "REINVEST_STAKING_REWARDS_L1"],
  description: "Withdraws accumulated L1 staking rewards and re-delegates them to the same Polygon validator.",
  validate: async (runtime, _message, _state) => {
    logger12.debug("Validating RESTAKE_REWARDS_L1 action...");
    const requiredSettings = ["PRIVATE_KEY", "ETHEREUM_RPC_URL", "POLYGON_PLUGINS_ENABLED"];
    for (const setting of requiredSettings) {
      if (!runtime.getSetting(setting)) {
        logger12.error(`Required setting ${setting} not configured for RESTAKE_REWARDS_L1 action.`);
        return false;
      }
    }
    try {
      const service = runtime.getService(PolygonRpcService.serviceType);
      if (!service) {
        logger12.error("PolygonRpcService not initialized for RESTAKE_REWARDS_L1.");
        return false;
      }
    } catch (error) {
      logger12.error(
        "Error accessing PolygonRpcService during RESTAKE_REWARDS_L1 validation:",
        error
      );
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _recentMessages) => {
    logger12.info("Handling RESTAKE_REWARDS_L1 action for message:", message.id);
    const rawMessageText = message.content.text || "";
    let params = null;
    try {
      const polygonService = runtime.getService(PolygonRpcService.serviceType);
      if (!polygonService) {
        throw new Error("PolygonRpcService not available");
      }
      const prompt = composePromptFromState11({
        state,
        template: restakeRewardsL1Template
        // Use the new template
      });
      try {
        const result = await runtime.useModel(ModelType11.TEXT_SMALL, { prompt });
        params = parseJSONObjectFromText8(result);
        logger12.debug("RESTAKE_REWARDS_L1: Extracted params via TEXT_SMALL:", params);
        if (params.error) {
          logger12.warn(`RESTAKE_REWARDS_L1: Model responded with error: ${params.error}`);
          throw new Error(params.error);
        }
      } catch (e) {
        logger12.warn(
          "RESTAKE_REWARDS_L1: Failed to parse JSON from model, trying manual extraction",
          e
        );
        const manualParams = extractParamsFromText5(rawMessageText);
        if (manualParams.validatorId) {
          params = { validatorId: manualParams.validatorId };
          logger12.debug("RESTAKE_REWARDS_L1: Extracted params via manual text parsing:", params);
        } else {
          throw new Error("Could not determine validator ID from the message.");
        }
      }
      if (!params?.validatorId) {
        throw new Error("Validator ID is missing after extraction attempts.");
      }
      const { validatorId } = params;
      logger12.info(`Action: Restaking rewards for validator ${validatorId} on L1`);
      const delegateTxHash = await polygonService.restakeRewards(validatorId);
      if (!delegateTxHash) {
        const noRewardsMsg = `No rewards found to restake for validator ${validatorId}.`;
        logger12.info(noRewardsMsg);
        const responseContent2 = {
          text: noRewardsMsg,
          actions: ["RESTAKE_REWARDS_L1"],
          source: message.content.source,
          data: { validatorId, status: "no_rewards", success: true }
          // success: true as operation completed as expected
        };
        if (callback) await callback(responseContent2);
        return responseContent2;
      }
      const successMsg = `Restake operation for validator ${validatorId} initiated. Final delegation transaction hash: ${delegateTxHash}.`;
      logger12.info(successMsg);
      const responseContent = {
        text: successMsg,
        actions: ["RESTAKE_REWARDS_L1"],
        source: message.content.source,
        data: {
          validatorId,
          transactionHash: delegateTxHash,
          status: "initiated",
          success: true
        }
      };
      if (callback) await callback(responseContent);
      return responseContent;
    } catch (error) {
      const parsedError = parseErrorMessage(error);
      logger12.error("Error in RESTAKE_REWARDS_L1 handler:", parsedError);
      const errorContent = {
        text: `Error restaking rewards (L1): ${parsedError.message}`,
        actions: ["RESTAKE_REWARDS_L1"],
        source: message.content.source,
        data: {
          success: false,
          error: parsedError.message,
          details: parsedError.details
        }
      };
      if (callback) await callback(errorContent);
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Restake my L1 rewards for validator 7."
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "Compound my staking rewards on Ethereum for validator ID 88."
        }
      }
    ]
  ]
};

// src/actions/isL2BlockCheckpointed.ts
import {
  logger as logger13,
  composePromptFromState as composePromptFromState12,
  ModelType as ModelType12,
  parseJSONObjectFromText as parseJSONObjectFromText9
} from "@elizaos/core";
var isL2BlockCheckpointedAction = {
  name: "IS_L2_BLOCK_CHECKPOINTED",
  description: "Checks if a Polygon L2 block has been checkpointed on Ethereum L1.",
  validate: async (runtime, _message, _state) => {
    logger13.debug("Validating IS_L2_BLOCK_CHECKPOINTED action...");
    const requiredSettings = [
      "PRIVATE_KEY",
      "ETHEREUM_RPC_URL",
      // L1 RPC needed for checkpoint verification
      "POLYGON_RPC_URL",
      // L2 RPC for completeness
      "POLYGON_PLUGINS_ENABLED"
    ];
    for (const setting of requiredSettings) {
      if (!runtime.getSetting(setting)) {
        logger13.error(
          `Required setting ${setting} not configured for IS_L2_BLOCK_CHECKPOINTED action.`
        );
        return false;
      }
    }
    try {
      const service = runtime.getService(PolygonRpcService.serviceType);
      if (!service) {
        logger13.error("PolygonRpcService not initialized.");
        return false;
      }
    } catch (error) {
      logger13.error("Error accessing PolygonRpcService during validation:", error);
      return false;
    }
    return true;
  },
  handler: async (runtime, message, state, _options, callback, _responses) => {
    logger13.info("Handling IS_L2_BLOCK_CHECKPOINTED action for message:", message.id);
    try {
      const rpcService = runtime.getService(PolygonRpcService.serviceType);
      if (!rpcService) throw new Error("PolygonRpcService not available");
      const prompt = composePromptFromState12({
        state: state ? state : { values: {}, data: {}, text: "" },
        template: isL2BlockCheckpointedTemplate
      });
      const modelResponse = await runtime.useModel(ModelType12.TEXT_SMALL, {
        prompt
      });
      let params;
      try {
        params = parseJSONObjectFromText9(modelResponse);
        logger13.debug("IS_L2_BLOCK_CHECKPOINTED: Extracted params:", params);
        if (params.error) {
          logger13.warn(`IS_L2_BLOCK_CHECKPOINTED: Model responded with error: ${params.error}`);
          throw new Error(params.error);
        }
      } catch (error) {
        logger13.error(
          "Failed to parse LLM response for checkpoint parameters:",
          modelResponse,
          error
        );
        throw new Error("Could not understand checkpoint parameters.");
      }
      if (params.l2BlockNumber === void 0) {
        throw new Error("L2 block number parameter not extracted properly.");
      }
      const l2BlockNumber = BigInt(params.l2BlockNumber);
      logger13.info(`Action: Checking checkpoint status for L2 block ${l2BlockNumber}`);
      const lastCheckpointedBlock = await rpcService.getLastCheckpointedL2Block();
      const isCheckpointed = await rpcService.isL2BlockCheckpointed(l2BlockNumber);
      const currentL2Block = await rpcService.getCurrentBlockNumber();
      const responseMsg = `Block ${l2BlockNumber} ${isCheckpointed ? "is" : "is not"} checkpointed on Ethereum L1. Last checkpointed block: ${lastCheckpointedBlock}`;
      logger13.info(responseMsg);
      const responseContent = {
        text: responseMsg,
        actions: ["IS_L2_BLOCK_CHECKPOINTED"],
        source: message.content.source,
        data: {
          l2BlockNumber: Number(l2BlockNumber),
          currentBlockNumber: currentL2Block,
          lastCheckpointedBlock: lastCheckpointedBlock.toString(),
          isCheckpointed
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger13.error("Failed to check if block is checkpointed:", error);
      const userFriendlyMessage = `Unable to verify checkpoint status. The CheckpointManager contract on Ethereum L1 encountered an error: ${errorMessage}. This could be due to a network issue or a contract configuration problem.`;
      const responseContent = {
        text: userFriendlyMessage,
        actions: ["IS_L2_BLOCK_CHECKPOINTED"],
        source: message.content.source,
        data: {
          error: errorMessage
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Is Polygon block 15000000 checkpointed on Ethereum yet?"
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "Check if L2 block 42123456 has been checkpointed"
        }
      }
    ]
  ]
};

// src/actions/heimdallVoteAction.ts
import {
  logger as logger15,
  composePromptFromState as composePromptFromState13,
  ModelType as ModelType13,
  parseJSONObjectFromText as parseJSONObjectFromText10
} from "@elizaos/core";

// src/services/HeimdallService.ts
import { coins, DirectSecp256k1Wallet } from "@cosmjs/proto-signing";
import { SigningStargateClient as ConcreteSigningStargateClient } from "@cosmjs/stargate";
import { Service as Service2, logger as logger14 } from "@elizaos/core";
var HEIMDALL_RPC_URL_KEY = "HEIMDALL_RPC_URL";
var PRIVATE_KEY_KEY = "PRIVATE_KEY";
var VoteOption = /* @__PURE__ */ ((VoteOption2) => {
  VoteOption2[VoteOption2["VOTE_OPTION_UNSPECIFIED"] = 0] = "VOTE_OPTION_UNSPECIFIED";
  VoteOption2[VoteOption2["VOTE_OPTION_YES"] = 1] = "VOTE_OPTION_YES";
  VoteOption2[VoteOption2["VOTE_OPTION_ABSTAIN"] = 2] = "VOTE_OPTION_ABSTAIN";
  VoteOption2[VoteOption2["VOTE_OPTION_NO"] = 3] = "VOTE_OPTION_NO";
  VoteOption2[VoteOption2["VOTE_OPTION_NO_WITH_VETO"] = 4] = "VOTE_OPTION_NO_WITH_VETO";
  return VoteOption2;
})(VoteOption || {});
var _HeimdallService = class _HeimdallService extends Service2 {
  constructor() {
    super(...arguments);
    this.capabilityDescription = "Provides access to Polygon Heimdall layer for governance operations.";
    this.heimdallRpcUrl = null;
    this.privateKey = null;
  }
  // initializeHeimdallClient will be called by the static start method
  async initializeHeimdallClient() {
    if (!this.runtime) {
      logger14.error("Agent runtime is not available for HeimdallService.");
      throw new Error("Agent runtime not available.");
    }
    this.heimdallRpcUrl = this.runtime.getSetting(HEIMDALL_RPC_URL_KEY);
    this.privateKey = this.runtime.getSetting(PRIVATE_KEY_KEY);
    if (!this.heimdallRpcUrl) {
      logger14.error(`Heimdall RPC URL setting (${HEIMDALL_RPC_URL_KEY}) not found.`);
      throw new Error("Heimdall RPC URL is not configured.");
    }
    if (!this.privateKey) {
      logger14.error(`Heimdall private key setting (${PRIVATE_KEY_KEY}) not found.`);
      throw new Error("Heimdall private key is not configured.");
    }
    logger14.info("HeimdallService initialized with necessary configurations.");
  }
  static async start(runtime) {
    logger14.info("Starting HeimdallService...");
    const service = new _HeimdallService(runtime);
    await service.initializeHeimdallClient();
    return service;
  }
  static async stop(runtime) {
    logger14.info("Stopping HeimdallService...");
    const service = runtime.getService(_HeimdallService.serviceType);
    if (service) {
      await service.stop();
    }
  }
  async stop() {
    logger14.info("HeimdallService instance stopped.");
    this.heimdallRpcUrl = null;
    this.privateKey = null;
  }
  async getSigner() {
    if (!this.privateKey) {
      logger14.error("Heimdall private key is not available in getSigner.");
      throw new Error("Heimdall private key is not configured for HeimdallService.");
    }
    try {
      const hexKey = this.privateKey.startsWith("0x") ? this.privateKey.substring(2) : this.privateKey;
      if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
        logger14.error("Invalid private key format. Expected 64 hex characters.");
        throw new Error("Invalid private key format.");
      }
      const privateKeyBytes = Uint8Array.from(Buffer.from(hexKey, "hex"));
      const signer = await DirectSecp256k1Wallet.fromKey(privateKeyBytes, "heimdall");
      return signer;
    } catch (error) {
      logger14.error(
        "Failed to create Heimdall signer from private key.",
        error instanceof Error ? error.message : String(error)
      );
      throw new Error("Failed to create Heimdall signer.");
    }
  }
  async getSigningClient() {
    if (!this.heimdallRpcUrl) {
      logger14.error("Heimdall RPC URL is not available in getSigningClient.");
      throw new Error("Heimdall RPC URL is not configured for HeimdallService.");
    }
    try {
      const signer = await this.getSigner();
      const options = {};
      const client = await ConcreteSigningStargateClient.connectWithSigner(
        this.heimdallRpcUrl,
        signer,
        options
      );
      logger14.debug("Successfully connected to Heimdall RPC with signer.");
      return client;
    } catch (error) {
      logger14.error(
        "Failed to connect to Heimdall RPC with signer.",
        error instanceof Error ? error.message : String(error)
      );
      throw new Error("Failed to connect to Heimdall RPC with signer.");
    }
  }
  /**
   * Asserts that a transaction was successful by checking its code.
   * @param result The broadcast tx result to check
   * @throws Error if the transaction failed
   */
  assertIsBroadcastTxSuccess(result) {
    if ("code" in result && result.code !== 0) {
      const message = result.rawLog || "Transaction failed";
      throw new Error(`Error when broadcasting tx: ${message}`);
    }
  }
  /**
   * Vote on a Heimdall governance proposal.
   *
   * @param proposalId The ID of the proposal to vote on
   * @param option The vote option (YES, NO, etc.)
   * @returns The transaction hash if successful
   */
  async voteOnProposal(proposalId, option) {
    logger14.info(`Attempting to vote on proposal ${proposalId} with option ${VoteOption[option]}`);
    try {
      const client = await this.getSigningClient();
      const signer = await this.getSigner();
      const accounts = await signer.getAccounts();
      if (accounts.length === 0) {
        throw new Error("No accounts found in wallet");
      }
      const voter = accounts[0].address;
      logger14.debug(`Voter address: ${voter}`);
      const msgVote = {
        typeUrl: "/cosmos.gov.v1beta1.MsgVote",
        value: {
          proposalId: proposalId.toString(),
          // Ensure proposalId is a string
          voter,
          option
        }
      };
      const fee = {
        amount: coins(_HeimdallService.DEFAULT_FEE_AMOUNT, _HeimdallService.DEFAULT_DENOM),
        gas: _HeimdallService.DEFAULT_GAS_LIMIT
      };
      logger14.debug("Broadcasting vote transaction...");
      const result = await client.signAndBroadcast(voter, [msgVote], fee);
      this.assertIsBroadcastTxSuccess(result);
      logger14.info(
        `Successfully voted on proposal ${proposalId}, tx hash: ${result.transactionHash}`
      );
      return result.transactionHash;
    } catch (error) {
      let errorMessage;
      if (error instanceof Error) {
        errorMessage = error.message;
        if (errorMessage.includes("insufficient fee")) {
          errorMessage = "Insufficient fee for Heimdall transaction. Try increasing the fee amount.";
        } else if (errorMessage.includes("proposal not found") || errorMessage.includes("not found")) {
          errorMessage = `Proposal ${proposalId} not found or no longer in voting period.`;
        } else if (errorMessage.includes("already voted")) {
          errorMessage = `This account has already voted on proposal ${proposalId}.`;
        }
      } else {
        errorMessage = String(error);
      }
      logger14.error(`Failed to vote on proposal ${proposalId}:`, errorMessage);
      throw new Error(`Vote failed: ${errorMessage}`);
    }
  }
  async submitProposal(content, initialDepositAmount, initialDepositDenom = "matic") {
    const contentType = "changes" in content ? "ParameterChangeProposal" : "TextProposal";
    logger14.info(`Attempting to submit ${contentType}`);
    try {
      const client = await this.getSigningClient();
      const signer = await this.getSigner();
      const accounts = await signer.getAccounts();
      if (accounts.length === 0) {
        throw new Error("No accounts found in wallet");
      }
      const proposer = accounts[0].address;
      logger14.debug(`Proposal from address: ${proposer}`);
      let typeUrl;
      if ("changes" in content) {
        typeUrl = "/cosmos.params.v1beta1.ParameterChangeProposal";
        logger14.debug(`Parameter change proposal: ${content.title}`);
      } else {
        typeUrl = "/cosmos.gov.v1beta1.TextProposal";
        logger14.debug(`Text proposal: ${content.title}`);
      }
      const msgSubmitProposal = {
        typeUrl: "/cosmos.gov.v1beta1.MsgSubmitProposal",
        value: {
          content: {
            typeUrl,
            value: content
            // When using cosmjs, this will get properly converted/encoded
          },
          initialDeposit: coins(initialDepositAmount, initialDepositDenom),
          proposer
        }
      };
      const fee = {
        amount: coins(_HeimdallService.DEFAULT_FEE_AMOUNT, _HeimdallService.DEFAULT_DENOM),
        gas: _HeimdallService.DEFAULT_GAS_LIMIT
      };
      logger14.debug("Broadcasting submit proposal transaction...");
      const result = await client.signAndBroadcast(proposer, [msgSubmitProposal], fee);
      this.assertIsBroadcastTxSuccess(result);
      logger14.info(`Successfully submitted proposal, tx hash: ${result.transactionHash}`);
      return result.transactionHash;
    } catch (error) {
      let errorMessage;
      if (error instanceof Error) {
        errorMessage = error.message;
        if (errorMessage.includes("insufficient fee")) {
          errorMessage = "Insufficient fee for Heimdall transaction. Try increasing the fee amount.";
        } else if (errorMessage.includes("minimum deposit")) {
          errorMessage = "The initial deposit is below the minimum required for proposals.";
        }
      } else {
        errorMessage = String(error);
      }
      logger14.error("Failed to submit proposal:", errorMessage);
      throw new Error(`Proposal submission failed: ${errorMessage}`);
    }
  }
  async transferHeimdallTokens(recipientAddress, amount, denom = "matic") {
    logger14.info(`Attempting to transfer ${amount} ${denom} to ${recipientAddress} on Heimdall`);
    try {
      const client = await this.getSigningClient();
      const signer = await this.getSigner();
      const accounts = await signer.getAccounts();
      if (accounts.length === 0) {
        throw new Error("No accounts found in wallet");
      }
      const sender = accounts[0].address;
      logger14.debug(`Sender address: ${sender}`);
      if (!recipientAddress.startsWith("heimdall")) {
        throw new Error(
          `Invalid recipient address format: ${recipientAddress}. Must start with "heimdall"`
        );
      }
      const msgSend = {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: {
          fromAddress: sender,
          toAddress: recipientAddress,
          amount: coins(amount, denom)
        }
      };
      const fee = {
        amount: coins(_HeimdallService.DEFAULT_FEE_AMOUNT, _HeimdallService.DEFAULT_DENOM),
        gas: _HeimdallService.DEFAULT_GAS_LIMIT
      };
      logger14.debug(`Broadcasting transfer transaction to ${recipientAddress}...`);
      const result = await client.signAndBroadcast(sender, [msgSend], fee);
      this.assertIsBroadcastTxSuccess(result);
      logger14.info(
        `Successfully transferred ${amount} ${denom} to ${recipientAddress}, tx hash: ${result.transactionHash}`
      );
      return result.transactionHash;
    } catch (error) {
      let errorMessage;
      if (error instanceof Error) {
        errorMessage = error.message;
        if (errorMessage.includes("insufficient fee")) {
          errorMessage = "Insufficient fee for Heimdall transaction. Try increasing the fee amount.";
        } else if (errorMessage.includes("insufficient funds")) {
          errorMessage = `Insufficient funds to transfer ${amount} ${denom}. Check your balance on Heimdall.`;
        }
      } else {
        errorMessage = String(error);
      }
      logger14.error(`Failed to transfer tokens to ${recipientAddress}:`, errorMessage);
      throw new Error(`Transfer failed: ${errorMessage}`);
    }
  }
};
_HeimdallService.serviceType = "heimdall";
// Fee defaults for Heimdall transactions in MATIC - can be made configurable if needed
_HeimdallService.DEFAULT_GAS_LIMIT = "200000";
_HeimdallService.DEFAULT_FEE_AMOUNT = "5000000000000000";
// 0.005 MATIC
_HeimdallService.DEFAULT_DENOM = "matic";
var HeimdallService = _HeimdallService;

// src/actions/heimdallVoteAction.ts
import { z } from "zod";
var heimdallVoteParamsSchema = z.object({
  proposalId: z.union([z.string(), z.number()]).describe("The ID of the Heimdall governance proposal to vote on."),
  option: z.nativeEnum(VoteOption).describe(
    "The vote option (e.g., VOTE_OPTION_YES, VOTE_OPTION_NO). Provide the numeric value or the string key."
  )
});
function extractHeimdallVoteParamsFromText(text) {
  const params = {};
  logger15.debug(`Attempting to extract HeimdallVoteParams from text: "${text}".`);
  const proposalIdMatch = text.match(/\b(?:proposal\s*id|prop\s*id)\s*[:\-]?\s*([\w\d\-]+)/i);
  if (proposalIdMatch?.[1]) {
    const id = proposalIdMatch[1];
    params.proposalId = /^\d+$/.test(id) ? Number(id) : id;
  }
  const optionMatch = text.match(
    /\b(?:vote|option|support)\s*[:\-]?\s*(yes|no with veto|no|abstain|unspecified|1|2|3|4|0)/i
  );
  if (optionMatch?.[1]) {
    const optionStr = optionMatch[1].toLowerCase();
    if (optionStr === "yes" || optionStr === "1") params.option = 1 /* VOTE_OPTION_YES */;
    else if (optionStr === "no" || optionStr === "3") params.option = 3 /* VOTE_OPTION_NO */;
    else if (optionStr === "abstain" || optionStr === "2")
      params.option = 2 /* VOTE_OPTION_ABSTAIN */;
    else if (optionStr === "no with veto" || optionStr === "4")
      params.option = 4 /* VOTE_OPTION_NO_WITH_VETO */;
    else if (optionStr === "unspecified" || optionStr === "0")
      params.option = 0 /* VOTE_OPTION_UNSPECIFIED */;
  }
  logger15.debug("Manually extracted HeimdallVoteParams:", params);
  return params;
}
var heimdallVoteAction = {
  name: "HEIMDALL_VOTE_ON_PROPOSAL",
  similes: ["VOTE_HEIMDALL_PROPOSAL", "CAST_VOTE_ON_HEIMDALL", "HEIMDALL_GOVERNANCE_VOTE"],
  description: "Casts a vote on a Heimdall governance proposal.",
  validate: async (runtime) => {
    logger15.debug("Validating HEIMDALL_VOTE_ON_PROPOSAL action...");
    const heimdallRpcUrl = runtime.getSetting("HEIMDALL_RPC_URL");
    const privateKey = runtime.getSetting("PRIVATE_KEY");
    if (!heimdallRpcUrl) {
      logger15.error("HEIMDALL_RPC_URL is not configured for Heimdall actions.");
      return false;
    }
    if (!privateKey) {
      logger15.error("PRIVATE_KEY is not configured for Heimdall actions.");
      return false;
    }
    logger15.debug("HEIMDALL_VOTE_ON_PROPOSAL validation successful based on settings.");
    return true;
  },
  handler: async (runtime, message, state, _options, callback) => {
    logger15.info(`Handling HEIMDALL_VOTE_ON_PROPOSAL for message: ${message.id}`);
    const rawMessageText = message.content.text || "";
    let extractedParams = null;
    try {
      const heimdallService = runtime.getService(HeimdallService.serviceType);
      if (!heimdallService) {
        throw new Error("HeimdallService is not available. Ensure it is registered and started.");
      }
      try {
        const prompt = composePromptFromState13({
          state,
          template: heimdallVoteActionTemplate
          // Assumes this template is defined
        });
        const modelResponse = await runtime.useModel(ModelType13.TEXT_SMALL, {
          prompt
        });
        const parsed = parseJSONObjectFromText10(modelResponse);
        if (parsed) {
          extractedParams = parsed;
          if (extractedParams && extractedParams.option !== void 0) {
            const opt = String(extractedParams.option).toUpperCase().trim();
            if (opt === "YES" || opt === "1") {
              extractedParams.option = 1 /* VOTE_OPTION_YES */;
            } else if (opt === "NO" || opt === "3") {
              extractedParams.option = 3 /* VOTE_OPTION_NO */;
            } else if (opt === "ABSTAIN" || opt === "2") {
              extractedParams.option = 2 /* VOTE_OPTION_ABSTAIN */;
            } else if (opt === "NO_WITH_VETO" || opt === "NOWITHVETO" || opt === "NO WITH VETO" || opt === "4") {
              extractedParams.option = 4 /* VOTE_OPTION_NO_WITH_VETO */;
            } else if (opt === "UNSPECIFIED" || opt === "0") {
              extractedParams.option = 0 /* VOTE_OPTION_UNSPECIFIED */;
            } else {
              const numOpt = Number.parseInt(opt, 10);
              if (!isNaN(numOpt) && VoteOption[numOpt] !== void 0) {
                extractedParams.option = numOpt;
              } else {
                logger15.warn(
                  `Unrecognized vote option from LLM: ${extractedParams.option}. Validation will likely fail.`
                );
              }
            }
          }
        }
        logger15.debug(
          "HEIMDALL_VOTE_ON_PROPOSAL: Extracted params via TEXT_SMALL:",
          extractedParams
        );
        if (extractedParams?.error) {
          throw new Error(extractedParams.error);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger15.warn(
          `HEIMDALL_VOTE_ON_PROPOSAL: Failed to parse JSON from model response or model returned error (Proceeding to manual extraction): ${errorMsg}`
        );
      }
      if (!extractedParams || extractedParams.error || !extractedParams.proposalId || extractedParams.option === void 0) {
        logger15.info(
          "HEIMDALL_VOTE_ON_PROPOSAL: Model extraction insufficient or failed, attempting manual parameter extraction."
        );
        const manualParams = extractHeimdallVoteParamsFromText(rawMessageText);
        if (extractedParams && !extractedParams.error) {
          extractedParams = { ...manualParams, ...extractedParams };
        } else {
          extractedParams = manualParams;
        }
        logger15.debug(
          "HEIMDALL_VOTE_ON_PROPOSAL: Params after manual extraction attempt:",
          extractedParams
        );
      }
      const validatedParams = heimdallVoteParamsSchema.safeParse(extractedParams);
      if (!validatedParams.success) {
        logger15.error(
          "HEIMDALL_VOTE_ON_PROPOSAL: Invalid parameters after all extraction attempts.",
          validatedParams.error.flatten()
        );
        throw new Error(
          `Invalid parameters: ${validatedParams.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
        );
      }
      const { proposalId, option } = validatedParams.data;
      logger15.debug("Heimdall vote parameters for service:", {
        proposalId,
        option
      });
      const txHash = await heimdallService.voteOnProposal(proposalId, option);
      const successMsg = `Successfully voted ${VoteOption[option]} on Heimdall proposal ${proposalId}. Transaction Hash: ${txHash}`;
      logger15.info(successMsg);
      if (callback) {
        await callback({
          text: successMsg,
          content: {
            success: true,
            transactionHash: txHash,
            proposalId,
            voteOption: VoteOption[option]
          },
          actions: [heimdallVoteAction.name],
          source: message.content.source
        });
      }
      return {
        success: true,
        transactionHash: txHash,
        proposalId,
        voteOption: VoteOption[option]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger15.error("Error in HEIMDALL_VOTE_ON_PROPOSAL handler:", errMsg, error);
      if (callback) {
        await callback({
          text: `Error voting on Heimdall proposal: ${errMsg}`,
          actions: [heimdallVoteAction.name],
          source: message.content.source
        });
      }
      return { success: false, error: errMsg };
    }
  },
  examples: [
    [
      {
        name: "User votes YES on Heimdall",
        id: "heimdall-vote-ex1-user",
        role: "user",
        entityId: "user123",
        roomId: "room456",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        actions: ["HEIMDALL_VOTE_ON_PROPOSAL"],
        content: {
          text: "Vote YES on Heimdall proposal 42.",
          source: "user-input"
        }
      }
    ],
    [
      {
        name: "User votes NO on Heimdall",
        id: "heimdall-vote-ex2-user",
        role: "user",
        entityId: "user123",
        roomId: "room456",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        actions: ["HEIMDALL_VOTE_ON_PROPOSAL"],
        content: {
          text: "Cast a NO vote for Heimdall governance proposal ID 15.",
          source: "user-input"
        }
      }
    ],
    [
      {
        name: "User votes ABSTAIN on Heimdall",
        id: "heimdall-vote-ex3-user",
        role: "user",
        entityId: "user123",
        roomId: "room456",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        actions: ["HEIMDALL_VOTE_ON_PROPOSAL"],
        content: {
          text: "On Heimdall, vote ABSTAIN for proposal 77 using option 2.",
          source: "user-input"
        }
      }
    ]
  ]
};

// src/actions/heimdallSubmitProposalAction.ts
import {
  logger as logger16,
  composePromptFromState as composePromptFromState14,
  ModelType as ModelType14,
  parseJSONObjectFromText as parseJSONObjectFromText11
} from "@elizaos/core";
import { z as z2 } from "zod";
var paramChangeSchema = z2.object({
  subspace: z2.string().min(1),
  key: z2.string().min(1),
  value: z2.string()
  // Value can be empty string
});
var textProposalSchema = z2.object({
  type: z2.literal("TextProposal"),
  title: z2.string().min(1).describe("Title of the text proposal."),
  description: z2.string().min(1).describe("Description of the text proposal.")
});
var parameterChangeProposalSchema = z2.object({
  type: z2.literal("ParameterChangeProposal"),
  title: z2.string().min(1).describe("Title of the parameter change proposal."),
  description: z2.string().min(1).describe("Description of the parameter change proposal."),
  changes: z2.array(paramChangeSchema).min(1).describe("Array of parameter changes.")
});
var proposalContentSchema = z2.discriminatedUnion("type", [
  textProposalSchema,
  parameterChangeProposalSchema
]);
var heimdallSubmitProposalParamsSchema = z2.object({
  content: proposalContentSchema.describe(
    "The content of the proposal (TextProposal or ParameterChangeProposal)."
  ),
  initialDepositAmount: z2.string().min(1).describe('The amount of the initial deposit for the proposal (e.g., "10000000").'),
  initialDepositDenom: z2.string().optional().default("matic").describe('The denomination of the initial deposit (default: "matic").')
});
function extractHeimdallSubmitProposalParamsFromText(text) {
  logger16.debug(`Attempting to extract HeimdallSubmitProposalParams from text: "${text}".`);
  const params = {};
  const depositAmountMatch = text.match(/deposit(?:Amount)?[:\\-]?\\s*(\\d+)/i);
  if (depositAmountMatch?.[1]) params.initialDepositAmount = depositAmountMatch[1];
  const depositDenomMatch = text.match(/depositDenom[:\\-]?\\s*(\\w+)/i);
  if (depositDenomMatch?.[1]) params.initialDepositDenom = depositDenomMatch[1];
  const partialContent = {};
  const titleMatch = text.match(/title[:\\-]?\\s*([\"\'](.+?)[\"\']|([^,\\n{\\[]+))/i);
  if (titleMatch?.[2] || titleMatch?.[3]) {
    partialContent.title = (titleMatch[2] || titleMatch[3]).trim();
  }
  const descriptionMatch = text.match(/description[:\\-]?\\s*([\"\'](.+?)[\"\']|([^,\\n{\\[]+))/i);
  if (descriptionMatch?.[2] || descriptionMatch?.[3]) {
    partialContent.description = (descriptionMatch[2] || descriptionMatch[3]).trim();
  }
  if (text.toLowerCase().includes("parameterchange") || text.toLowerCase().includes("param change")) {
    partialContent.type = "ParameterChangeProposal";
  } else if (partialContent.title) {
    partialContent.type = "TextProposal";
  }
  if (Object.keys(partialContent).length > 0) {
    params.content = partialContent;
  }
  logger16.debug("Manually extracted HeimdallSubmitProposalParams (partial):", params);
  return params;
}
var heimdallSubmitProposalAction = {
  name: "HEIMDALL_SUBMIT_PROPOSAL",
  similes: [
    "SUBMIT_HEIMDALL_PROPOSAL",
    "CREATE_HEIMDALL_GOVERNANCE_PROPOSAL",
    "HEIMDALL_NEW_PROPOSAL"
  ],
  description: "Submits a new governance proposal (Text or ParameterChange) to Heimdall.",
  validate: async (runtime) => {
    logger16.debug("Validating HEIMDALL_SUBMIT_PROPOSAL action...");
    const heimdallRpcUrl = runtime.getSetting("HEIMDALL_RPC_URL");
    const privateKey = runtime.getSetting("PRIVATE_KEY");
    if (!heimdallRpcUrl) {
      logger16.error("HEIMDALL_RPC_URL is not configured.");
      return false;
    }
    if (!privateKey) {
      logger16.error("PRIVATE_KEY is not configured.");
      return false;
    }
    logger16.debug("HEIMDALL_SUBMIT_PROPOSAL validation successful.");
    return true;
  },
  handler: async (runtime, message, state, _options, callback) => {
    logger16.info(`Handling HEIMDALL_SUBMIT_PROPOSAL for message: ${message.id}`);
    const rawMessageText = message.content.text || "";
    let extractedParams = null;
    try {
      const heimdallService = runtime.getService(HeimdallService.serviceType);
      if (!heimdallService) {
        throw new Error("HeimdallService is not available.");
      }
      try {
        const prompt = composePromptFromState14({
          state: state ?? { values: {}, data: {}, text: "" },
          // Provide a default State object if state is undefined
          template: heimdallSubmitProposalActionTemplate
        });
        const modelResponse = await runtime.useModel(ModelType14.TEXT_SMALL, {
          prompt
        });
        logger16.debug(
          "HEIMDALL_SUBMIT_PROPOSAL: Raw modelResponse from runtime.useModel:",
          modelResponse
        );
        let jsonString = modelResponse;
        const regex = /```(?:json)?\s*([\s\S]*?)\s*```/;
        logger16.debug("HEIMDALL_SUBMIT_PROPOSAL: Regex to be used for stripping:", regex.toString());
        const match = modelResponse.match(regex);
        logger16.debug("HEIMDALL_SUBMIT_PROPOSAL: Result of modelResponse.match(regex):", match);
        if (match && match[1]) {
          logger16.debug("HEIMDALL_SUBMIT_PROPOSAL: Regex match found. match[1] is:", match[1]);
          jsonString = match[1];
          jsonString = jsonString.replace(/\/\/.*$/gm, "");
          logger16.debug(
            "HEIMDALL_SUBMIT_PROPOSAL: jsonString after stripping attempt and comment removal:",
            jsonString
          );
        } else {
          logger16.warn(
            "HEIMDALL_SUBMIT_PROPOSAL: Regex did not match or match[1] was empty. jsonString remains unstripped."
          );
        }
        logger16.debug(
          "Model's json response (this is jsonString passed to parseJSONObjectFromText):",
          jsonString
        );
        let directParseResult = null;
        let directParseError = null;
        try {
          directParseResult = JSON.parse(jsonString);
          logger16.debug(
            "HEIMDALL_SUBMIT_PROPOSAL: Direct JSON.parse(jsonString) SUCCEEDED. Result:",
            directParseResult
          );
        } catch (e) {
          directParseError = e instanceof Error ? e.message : String(e);
          logger16.error(
            "HEIMDALL_SUBMIT_PROPOSAL: Direct JSON.parse(jsonString) FAILED. Error:",
            directParseError
          );
          logger16.error(
            "HEIMDALL_SUBMIT_PROPOSAL: jsonString that failed direct parse was:",
            jsonString
          );
        }
        const parsed = directParseResult ?? parseJSONObjectFromText11(jsonString);
        logger16.debug(
          "HEIMDALL_SUBMIT_PROPOSAL: Result from parseJSONObjectFromText(jsonString) or directParseResult:",
          parsed
        );
        if (parsed) {
          extractedParams = parsed;
        }
        logger16.debug("HEIMDALL_SUBMIT_PROPOSAL: Extracted params via TEXT_SMALL:", extractedParams);
        if (extractedParams?.error) {
          throw new Error(extractedParams.error);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger16.warn(
          `HEIMDALL_SUBMIT_PROPOSAL: Failed to parse JSON from model (Proceeding to manual): ${errorMsg}`
        );
      }
      if (!extractedParams || extractedParams.error && extractedParams.error.trim() !== "" || !extractedParams.content || !extractedParams.initialDepositAmount) {
        logger16.info(
          "HEIMDALL_SUBMIT_PROPOSAL: Model extraction insufficient, attempting manual parameter extraction."
        );
        const manualParams = extractHeimdallSubmitProposalParamsFromText(rawMessageText);
        if (extractedParams && !extractedParams.error) {
          extractedParams = { ...manualParams, ...extractedParams };
          if (manualParams.content && extractedParams.content) {
            extractedParams.content = {
              ...manualParams.content,
              ...extractedParams.content
            };
          }
        } else {
          extractedParams = manualParams;
        }
        logger16.debug("HEIMDALL_SUBMIT_PROPOSAL: Params after manual extraction:", extractedParams);
      }
      const validatedParams = heimdallSubmitProposalParamsSchema.safeParse(extractedParams);
      if (!validatedParams.success) {
        logger16.error(
          "HEIMDALL_SUBMIT_PROPOSAL: Invalid parameters.",
          validatedParams.error.flatten()
        );
        throw new Error(
          `Invalid parameters: ${validatedParams.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
        );
      }
      const { content, initialDepositAmount, initialDepositDenom } = validatedParams.data;
      const { type, ...actualContent } = content;
      const txHash = await heimdallService.submitProposal(
        actualContent,
        // Cast to service-level types
        initialDepositAmount,
        initialDepositDenom
      );
      const successMsg = `Successfully submitted Heimdall proposal. Type: ${type}, Title: ${actualContent.title}. Tx Hash: ${txHash}`;
      logger16.info(successMsg);
      if (callback) {
        await callback({
          text: successMsg,
          content: {
            success: true,
            transactionHash: txHash,
            proposalType: type,
            title: actualContent.title
          },
          actions: [heimdallSubmitProposalAction.name],
          source: message.content.source
        });
      }
      return {
        success: true,
        transactionHash: txHash,
        proposalType: type,
        title: actualContent.title
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger16.error("Error in HEIMDALL_SUBMIT_PROPOSAL handler:", errMsg, error);
      if (callback) {
        await callback({
          text: `Error submitting Heimdall proposal: ${errMsg}`,
          actions: [heimdallSubmitProposalAction.name],
          source: message.content.source
        });
      }
      return { success: false, error: errMsg };
    }
  },
  examples: [
    [
      {
        name: "User submits Heimdall TextProposal",
        id: "hsp-ex1-user",
        role: "user",
        entityId: "u1",
        roomId: "r1",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        actions: ["HEIMDALL_SUBMIT_PROPOSAL"],
        content: {
          text: "Submit a Heimdall text proposal titled 'Network Upgrade Info' with description 'Details about upcoming v2 upgrade.' and deposit 10000000 matic.",
          source: "user-input"
        }
      }
    ],
    [
      {
        name: "User submits Heimdall ParameterChangeProposal",
        id: "hsp-ex2-user",
        role: "user",
        entityId: "u1",
        roomId: "r1",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        actions: ["HEIMDALL_SUBMIT_PROPOSAL"],
        content: {
          text: "Propose a parameter change on Heimdall. Title: 'Update Staking Param', Description: 'Increase max validators'. Change subspace 'staking', key 'MaxValidators', value '120'. Initial deposit: 5000000 matic.",
          source: "user-input"
        }
      }
    ]
  ]
};

// src/actions/heimdallTransferTokensAction.ts
import {
  logger as logger17,
  composePromptFromState as composePromptFromState15,
  ModelType as ModelType15,
  parseJSONObjectFromText as parseJSONObjectFromText12
} from "@elizaos/core";
import { z as z3 } from "zod";
var heimdallTransferTokensParamsSchema = z3.object({
  recipientAddress: z3.string().startsWith(
    "heimdallvaloper",
    'Recipient address must start with "heimdallvaloper" for validators or "heimdall" for regular addresses.'
  ).or(
    z3.string().startsWith(
      "heimdall",
      'Recipient address must start with "heimdallvaloper" for validators or "heimdall" for regular addresses.'
    )
  ).describe(
    'The Heimdall address of the recipient (must start with "heimdall" or "heimdallvaloper").'
  ),
  amount: z3.string().min(1).regex(/^\\d+$/, "Amount must be a string containing only digits (Wei).").describe('The amount of tokens to transfer in Wei (e.g., "1000000000000000000").'),
  denom: z3.string().optional().default("matic").describe('The denomination of the tokens (default: "matic").')
});
function extractHeimdallTransferTokensParamsFromText(text) {
  const params = {};
  logger17.debug(`Attempting to extract HeimdallTransferTokensParams from text: "${text}".`);
  const recipientMatch = text.match(
    /\\b(?:to|recipient|receiver)\\s*[:\\-]?\\s*(heimdall(?:valoper)?[a-zA-Z0-9]+)/i
  );
  if (recipientMatch?.[1]) params.recipientAddress = recipientMatch[1];
  const amountMatch = text.match(/\\b(amount|sum)\\s*[:\\-]?\\s*(\\d+)/i);
  if (amountMatch?.[2]) params.amount = amountMatch[2];
  const denomMatch = text.match(/\\b(denom|denomination|currency)\\s*[:\\-]?\\s*(\\w+)/i);
  if (denomMatch?.[2]) params.denom = denomMatch[2].toLowerCase();
  logger17.debug("Manually extracted HeimdallTransferTokensParams:", params);
  return params;
}
var heimdallTransferTokensAction = {
  name: "HEIMDALL_TRANSFER_TOKENS",
  similes: ["TRANSFER_HEIMDALL_MATIC", "SEND_HEIMDALL_TOKENS", "HEIMDALL_TOKEN_TRANSFER"],
  description: "Transfers native tokens (e.g., MATIC) on the Heimdall network.",
  validate: async (runtime) => {
    logger17.debug("Validating HEIMDALL_TRANSFER_TOKENS action...");
    const heimdallRpcUrl = runtime.getSetting("HEIMDALL_RPC_URL");
    const privateKey = runtime.getSetting("PRIVATE_KEY");
    if (!heimdallRpcUrl) {
      logger17.error("HEIMDALL_RPC_URL is not configured.");
      return false;
    }
    if (!privateKey) {
      logger17.error("PRIVATE_KEY is not configured.");
      return false;
    }
    logger17.debug("HEIMDALL_TRANSFER_TOKENS validation successful.");
    return true;
  },
  handler: async (runtime, message, state, _options, callback) => {
    logger17.info(`Handling HEIMDALL_TRANSFER_TOKENS for message: ${message.id}`);
    const rawMessageText = message.content.text || "";
    let extractedParams = null;
    try {
      const heimdallService = runtime.getService(HeimdallService.serviceType);
      if (!heimdallService) {
        throw new Error("HeimdallService is not available.");
      }
      try {
        const prompt = composePromptFromState15({
          state,
          template: heimdallTransferTokensActionTemplate
        });
        const modelResponse = await runtime.useModel(ModelType15.TEXT_SMALL, {
          prompt
        });
        const parsed = parseJSONObjectFromText12(modelResponse);
        if (parsed) {
          extractedParams = parsed;
        }
        logger17.debug("HEIMDALL_TRANSFER_TOKENS: Extracted params via TEXT_SMALL:", extractedParams);
        if (extractedParams?.error) {
          throw new Error(extractedParams.error);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger17.warn(
          `HEIMDALL_TRANSFER_TOKENS: Failed to parse JSON from model (Proceeding to manual): ${errorMsg}`
        );
      }
      if (!extractedParams || extractedParams.error || !extractedParams.recipientAddress || !extractedParams.amount) {
        logger17.info(
          "HEIMDALL_TRANSFER_TOKENS: Model extraction insufficient, attempting manual extraction."
        );
        const manualParams = extractHeimdallTransferTokensParamsFromText(rawMessageText);
        if (extractedParams && !extractedParams.error) {
          extractedParams = { ...manualParams, ...extractedParams };
        } else {
          extractedParams = manualParams;
        }
        logger17.debug("HEIMDALL_TRANSFER_TOKENS: Params after manual extraction:", extractedParams);
      }
      const validatedParams = heimdallTransferTokensParamsSchema.safeParse(extractedParams);
      if (!validatedParams.success) {
        logger17.error(
          "HEIMDALL_TRANSFER_TOKENS: Invalid parameters.",
          validatedParams.error.flatten()
        );
        throw new Error(
          `Invalid parameters: ${validatedParams.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
        );
      }
      const { recipientAddress, amount, denom } = validatedParams.data;
      const txHash = await heimdallService.transferHeimdallTokens(recipientAddress, amount, denom);
      const successMsg = `Successfully transferred ${amount} ${denom || "matic"} to ${recipientAddress} on Heimdall. Tx Hash: ${txHash}`;
      logger17.info(successMsg);
      if (callback) {
        await callback({
          text: successMsg,
          content: {
            success: true,
            transactionHash: txHash,
            recipientAddress,
            amount,
            denom
          },
          actions: [heimdallTransferTokensAction.name],
          source: message.content.source
        });
      }
      return {
        success: true,
        transactionHash: txHash,
        recipientAddress,
        amount,
        denom
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger17.error("Error in HEIMDALL_TRANSFER_TOKENS handler:", errMsg, error);
      if (callback) {
        await callback({
          text: `Error transferring Heimdall tokens: ${errMsg}`,
          actions: [heimdallTransferTokensAction.name],
          source: message.content.source
        });
      }
      return { success: false, error: errMsg };
    }
  },
  examples: [
    [
      {
        name: "User transfers Heimdall MATIC",
        id: "htt-ex1-user",
        role: "user",
        entityId: "u1",
        roomId: "r1",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        actions: ["HEIMDALL_TRANSFER_TOKENS"],
        content: {
          text: "Send 0.5 MATIC on Heimdall to heimdall1recipientaddress. The amount is 500000000000000000 in wei.",
          source: "user-input"
        }
      }
    ],
    [
      {
        name: "User transfers Heimdall tokens with different denom",
        id: "htt-ex2-user",
        role: "user",
        entityId: "u1",
        roomId: "r1",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        actions: ["HEIMDALL_TRANSFER_TOKENS"],
        content: {
          text: "Transfer 100000 uatom on Heimdall to heimdallvaloper1validatoraddress.",
          source: "user-input"
        }
      }
    ]
  ]
};

// src/actions/getBalanceInfo.ts
import {
  logger as logger18
} from "@elizaos/core";
import { ethers as ethers4 } from "ethers";
var USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
var WETH_ADDRESS = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
var getUSDCBalanceAction = {
  name: "GET_USDC_BALANCE",
  similes: ["CHECK_USDC_BALANCE", "SHOW_USDC_BALANCE", "GET_USDC_AMOUNT"],
  description: "Gets the USDC balance for the agent wallet on Polygon.",
  validate: async (runtime, message, state) => {
    const content = message.content?.text?.toLowerCase() || "";
    logger18.info(`[getUSDCBalanceAction] VALIDATION CALLED - message: "${content}"`);
    try {
      const usdcKeywords = [
        "usdc balance",
        "usdc amount",
        "my usdc",
        "get usdc",
        "show usdc",
        "check usdc",
        "usdc wallet",
        "balance usdc",
        "how much usdc"
      ];
      const matches = usdcKeywords.some((keyword) => content.includes(keyword));
      logger18.info(`[getUSDCBalanceAction] Validation result: ${matches}`);
      const rpcService = runtime.getService(PolygonRpcService.serviceType);
      if (!rpcService) {
        logger18.warn(`[getUSDCBalanceAction] PolygonRpcService not available - validation false`);
        return false;
      }
      return matches;
    } catch (error) {
      logger18.error(`[getUSDCBalanceAction] Validation error:`, error);
      return false;
    }
  },
  handler: async (runtime, message, state, options, callback) => {
    logger18.info("[getUSDCBalanceAction] Handler called!");
    const rpcService = runtime.getService(PolygonRpcService.serviceType);
    if (!rpcService) {
      throw new Error("PolygonRpcService not available");
    }
    try {
      const polygonWalletProvider2 = await initWalletProvider(runtime);
      if (!polygonWalletProvider2) {
        throw new Error(
          "Failed to initialize PolygonWalletProvider - check that PRIVATE_KEY is configured correctly"
        );
      }
      const agentAddress = polygonWalletProvider2.getAddress();
      if (!agentAddress) {
        throw new Error("Could not determine agent address from provider");
      }
      logger18.info(`Getting USDC balance for address: ${agentAddress}`);
      const balance = await rpcService.getErc20Balance(USDC_ADDRESS, agentAddress);
      const formattedBalance = ethers4.formatUnits(balance, 6);
      const responseContent = {
        text: `Your USDC balance (${agentAddress}): ${formattedBalance} USDC`,
        actions: ["GET_USDC_BALANCE"],
        data: {
          address: agentAddress,
          tokenAddress: USDC_ADDRESS,
          balance: balance.toString(),
          formattedBalance,
          symbol: "USDC",
          decimals: 6
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } catch (error) {
      logger18.error("Error getting USDC balance:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorContent = {
        text: `Error retrieving USDC balance: ${errorMessage}`,
        actions: ["GET_USDC_BALANCE"],
        data: { error: errorMessage }
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "get my usdc balance"
        }
      },
      {
        name: "assistant",
        content: {
          text: "Your USDC balance (0x1234...): 1,250.50 USDC",
          actions: ["GET_USDC_BALANCE"]
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "how much usdc do i have"
        }
      },
      {
        name: "assistant",
        content: {
          text: "Your USDC balance (0x1234...): 1,250.50 USDC",
          actions: ["GET_USDC_BALANCE"]
        }
      }
    ]
  ]
};
var getWETHBalanceAction = {
  name: "GET_WETH_BALANCE",
  similes: ["CHECK_WETH_BALANCE", "SHOW_WETH_BALANCE", "GET_WETH_AMOUNT"],
  description: "Gets the WETH balance for the agent wallet on Polygon.",
  validate: async (runtime, message, state) => {
    const content = message.content?.text?.toLowerCase() || "";
    logger18.info(`[getWETHBalanceAction] VALIDATION CALLED - message: "${content}"`);
    try {
      const wethKeywords = [
        "weth balance",
        "weth amount",
        "my weth",
        "get weth",
        "show weth",
        "check weth",
        "weth wallet",
        "balance weth",
        "how much weth",
        "wrapped eth",
        "wrapped ethereum"
      ];
      const matches = wethKeywords.some((keyword) => content.includes(keyword));
      logger18.info(`[getWETHBalanceAction] Validation result: ${matches}`);
      const rpcService = runtime.getService(PolygonRpcService.serviceType);
      if (!rpcService) {
        logger18.warn(`[getWETHBalanceAction] PolygonRpcService not available - validation false`);
        return false;
      }
      return matches;
    } catch (error) {
      logger18.error(`[getWETHBalanceAction] Validation error:`, error);
      return false;
    }
  },
  handler: async (runtime, message, state, options, callback) => {
    logger18.info("[getWETHBalanceAction] Handler called!");
    const rpcService = runtime.getService(PolygonRpcService.serviceType);
    if (!rpcService) {
      throw new Error("PolygonRpcService not available");
    }
    try {
      const polygonWalletProvider2 = await initWalletProvider(runtime);
      if (!polygonWalletProvider2) {
        throw new Error(
          "Failed to initialize PolygonWalletProvider - check that PRIVATE_KEY is configured correctly"
        );
      }
      const agentAddress = polygonWalletProvider2.getAddress();
      if (!agentAddress) {
        throw new Error("Could not determine agent address from provider");
      }
      logger18.info(`Getting WETH balance for address: ${agentAddress}`);
      const balance = await rpcService.getErc20Balance(WETH_ADDRESS, agentAddress);
      const formattedBalance = ethers4.formatEther(balance);
      const responseContent = {
        text: `Your WETH balance (${agentAddress}): ${formattedBalance} WETH`,
        actions: ["GET_WETH_BALANCE"],
        data: {
          address: agentAddress,
          tokenAddress: WETH_ADDRESS,
          balance: balance.toString(),
          formattedBalance,
          symbol: "WETH",
          decimals: 18
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } catch (error) {
      logger18.error("Error getting WETH balance:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorContent = {
        text: `Error retrieving WETH balance: ${errorMessage}`,
        actions: ["GET_WETH_BALANCE"],
        data: { error: errorMessage }
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "get my weth balance"
        }
      },
      {
        name: "assistant",
        content: {
          text: "Your WETH balance (0x1234...): 0.5 WETH",
          actions: ["GET_WETH_BALANCE"]
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "check me weth balance"
        }
      },
      {
        name: "assistant",
        content: {
          text: "Your WETH balance (0x1234...): 0.5 WETH",
          actions: ["GET_WETH_BALANCE"]
        }
      }
    ]
  ]
};

// src/actions/getBlockInfo.ts
import { logger as logger19 } from "@elizaos/core";
import { z as z4 } from "zod";

// src/utils/formatters.ts
import { formatUnits as viemFormatUnits, parseUnits as viemParseUnits } from "viem";

// src/actions/getBlockInfo.ts
var getBlockNumberAction = {
  name: "GET_L2_BLOCK_NUMBER",
  description: "Gets the current block number on Polygon (L2).",
  // Define examples for how to use this action
  examples: [
    [
      {
        name: "User",
        content: { text: "What is the current block number on Polygon?" }
      }
    ],
    [
      {
        name: "User",
        content: { text: "Get latest Polygon block height" }
      }
    ],
    [
      {
        name: "User",
        content: { text: "Fetch current block number for L2" }
      }
    ]
  ],
  // Validation function
  validate: async (runtime, message) => {
    const content = message.content?.text?.toLowerCase() || "";
    const blockNumberKeywords = [
      "block number",
      "current block",
      "latest block",
      "polygon block number",
      "get polygon block",
      "block height",
      "current polygon block",
      "latest polygon block"
    ];
    return blockNumberKeywords.some((keyword) => content.includes(keyword));
  },
  // Actual handler function that performs the operation
  handler: async (runtime, message, state) => {
    logger19.info("Getting current Polygon block number");
    const rpcService = runtime.getService(PolygonRpcService.serviceType);
    if (!rpcService) {
      logger19.error("PolygonRpcService not available");
      throw new Error("PolygonRpcService not available");
    }
    logger19.info("Fetching the current block number from Polygon network...");
    const blockNumber = await rpcService.getCurrentBlockNumber();
    logger19.info(`Successfully retrieved current block number: ${blockNumber}`);
    return {
      text: `Current Polygon block number: ${blockNumber}`,
      actions: ["GET_L2_BLOCK_NUMBER"],
      data: { blockNumber }
    };
  }
};
var blockIdentifierSchema = z4.union([
  z4.number().positive("Block number must be positive"),
  z4.string().regex(/^0x[a-fA-F0-9]{64}$/, "Block hash must be a valid hex string")
]);
var blockOptionsSchema = z4.object({
  blockNumber: z4.number().int().positive().optional(),
  blockHash: z4.string().regex(/^0x[a-fA-F0-9]{64}$/).optional()
}).refine((data) => data.blockNumber !== void 0 || data.blockHash !== void 0, {
  message: "Either blockNumber or blockHash must be provided"
});

// src/actions/getPolygonBlockDetails.ts
import {
  logger as logger20
} from "@elizaos/core";
var getPolygonBlockDetailsAction = {
  name: "GET_POLYGON_BLOCK_DETAILS",
  similes: ["SHOW_BLOCK_INFO", "GET_BLOCK_DATA", "CHECK_BLOCK_DETAILS", "GET_POLYGON_BLOCK_INFO"],
  description: "Gets details for a specific Polygon block when a block number is mentioned.",
  validate: async (runtime, message, state) => {
    const content = message.content?.text?.toLowerCase() || "";
    logger20.info(`[getPolygonBlockDetailsAction] VALIDATION CALLED - message: "${content}"`);
    try {
      const blockDetailsKeywords = [
        "block details",
        "details of block",
        "details of the block",
        "get the details of block",
        "get the details of the block",
        "get details of block",
        "get details of the block",
        "polygon block details",
        "polygon block information",
        "block information",
        "get details",
        "show me block",
        "details for block",
        "get me the polygon block",
        "show polygon block",
        "polygon block info",
        "block info",
        "show block details",
        "get block details",
        "block data",
        "get block data"
      ];
      const matches = blockDetailsKeywords.some((keyword) => content.includes(keyword));
      const hasBlockNumber = /block\s+\d+|details.*\d+/.test(content);
      const result = matches || hasBlockNumber;
      logger20.info(
        `[getPolygonBlockDetailsAction] Validation result: ${result} (keywords: ${matches}, hasBlockNumber: ${hasBlockNumber})`
      );
      const rpcService = runtime.getService(PolygonRpcService.serviceType);
      if (!rpcService) {
        logger20.warn(
          `[getPolygonBlockDetailsAction] PolygonRpcService not available - validation false`
        );
        return false;
      }
      return result;
    } catch (error) {
      logger20.error(`[getPolygonBlockDetailsAction] Validation error:`, error);
      return false;
    }
  },
  handler: async (runtime, message, state, options, callback) => {
    logger20.info("[getPolygonBlockDetailsAction] Handler called!");
    const rpcService = runtime.getService(PolygonRpcService.serviceType);
    if (!rpcService) {
      throw new Error("PolygonRpcService not available");
    }
    try {
      const content = message.content?.text || "";
      let blockNumber;
      const blockNumberMatches = [
        /block\s+(\d+)/i,
        /details.*block\s+(\d+)/i,
        /details.*of.*(\d+)/i,
        /get.*details.*(\d+)/i,
        /(\d{7,})/
        // Match any large number (likely a block number)
      ];
      let extractedBlockNumber = null;
      for (const regex of blockNumberMatches) {
        const match = content.match(regex);
        if (match) {
          extractedBlockNumber = match[1];
          break;
        }
      }
      if (extractedBlockNumber) {
        blockNumber = parseInt(extractedBlockNumber);
        logger20.info(`Extracted block number ${blockNumber} from message: "${content}"`);
      } else {
        blockNumber = await rpcService.getCurrentBlockNumber();
        logger20.info(`No block number found in message, using current block: ${blockNumber}`);
      }
      logger20.info(`Getting details for Polygon block: ${blockNumber}`);
      const blockDetails = await rpcService.getBlockDetails(blockNumber);
      if (!blockDetails) {
        const notFoundContent = {
          text: `Block ${blockNumber} not found on Polygon.`,
          actions: ["GET_POLYGON_BLOCK_DETAILS"],
          data: { blockNumber, found: false }
        };
        if (callback) {
          await callback(notFoundContent);
        }
        return notFoundContent;
      }
      const responseContent = {
        text: `Polygon Block ${blockNumber} Details:
- Hash: ${blockDetails.hash}
- Parent Hash: ${blockDetails.parentHash}
- Timestamp: ${new Date(blockDetails.timestamp * 1e3).toISOString()}
- Gas Used: ${blockDetails.gasUsed.toString()}
- Gas Limit: ${blockDetails.gasLimit.toString()}
- Transaction Count: ${blockDetails.transactions.length}
- Miner: ${blockDetails.miner}`,
        actions: ["GET_POLYGON_BLOCK_DETAILS"],
        data: {
          blockNumber,
          blockDetails: {
            hash: blockDetails.hash,
            parentHash: blockDetails.parentHash,
            timestamp: blockDetails.timestamp,
            gasUsed: blockDetails.gasUsed.toString(),
            gasLimit: blockDetails.gasLimit.toString(),
            transactionCount: blockDetails.transactions.length,
            miner: blockDetails.miner
          }
        }
      };
      if (callback) {
        await callback(responseContent);
      }
      return responseContent;
    } catch (error) {
      logger20.error("Error getting Polygon block details:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorContent = {
        text: `Error retrieving Polygon block details: ${errorMessage}`,
        actions: ["GET_POLYGON_BLOCK_DETAILS"],
        data: { error: errorMessage }
      };
      if (callback) {
        await callback(errorContent);
      }
      return errorContent;
    }
  },
  examples: [
    [
      {
        name: "user",
        content: {
          text: "get me the details of polygon block 42000000"
        }
      },
      {
        name: "assistant",
        content: {
          text: "Polygon Block 42000000 Details:\n- Hash: 0x1234...\n- Parent Hash: 0x5678...\n- Timestamp: 2024-01-01T00:00:00.000Z\n- Gas Used: 15000000\n- Gas Limit: 30000000\n- Transaction Count: 150\n- Miner: 0xabcd...",
          actions: ["GET_POLYGON_BLOCK_DETAILS"]
        }
      }
    ],
    [
      {
        name: "user",
        content: {
          text: "show me the polygon block details"
        }
      },
      {
        name: "assistant",
        content: {
          text: "Polygon Block 65123456 Details:\n- Hash: 0x1234...\n- Parent Hash: 0x5678...\n- Timestamp: 2024-01-01T00:00:00.000Z\n- Gas Used: 15000000\n- Gas Limit: 30000000\n- Transaction Count: 150\n- Miner: 0xabcd...",
          actions: ["GET_POLYGON_BLOCK_DETAILS"]
        }
      }
    ]
  ]
};

// src/index.ts
process.on("unhandledRejection", (reason, promise) => {
  logger21.error("Unhandled Promise Rejection:", reason);
});
var configSchema = z5.object({
  POLYGON_RPC_URL: z5.string().url("Invalid Polygon RPC URL").min(1),
  ETHEREUM_RPC_URL: z5.string().url("Invalid Ethereum RPC URL").min(1),
  PRIVATE_KEY: z5.string().min(1, "Private key is required"),
  POLYGONSCAN_KEY: z5.string().min(1, "PolygonScan API Key is required"),
  HEIMDALL_RPC_URL: z5.string().url("Invalid Heimdall RPC URL").min(1).optional()
});
var polygonActions = [
  transferPolygonAction,
  getValidatorInfoAction,
  getDelegatorInfoAction,
  bridgeDepositAction,
  getCheckpointStatusAction,
  proposeGovernanceAction,
  voteGovernanceAction,
  getL2BlockNumberAction,
  getMaticBalanceAction,
  getPolygonGasEstimatesAction,
  delegateL1Action,
  undelegateL1Action,
  withdrawRewardsAction,
  restakeRewardsL1Action,
  isL2BlockCheckpointedAction,
  heimdallVoteAction,
  heimdallSubmitProposalAction,
  heimdallTransferTokensAction,
  getBlockNumberAction,
  // getBlockDetailsAction,  // Temporarily disabled - uses old interface, conflicts with getPolygonBlockDetailsAction
  getPolygonBlockDetailsAction,
  getUSDCBalanceAction,
  getWETHBalanceAction
];
logger21.info(`[PolygonPlugin] Registering ${polygonActions.length} actions:`);
polygonActions.forEach((action) => {
  logger21.info(
    `[PolygonPlugin] - Action: ${action.name} (similes: ${action.similes?.join(", ") || "none"})`
  );
});
logger21.info(
  `[PolygonPlugin] Actions with new interface: GET_MATIC_BALANCE, GET_L2_BLOCK_NUMBER, GET_POLYGON_BLOCK_DETAILS, GET_USDC_BALANCE, GET_WETH_BALANCE`
);
var polygonProviderInfo = {
  name: "Polygon Provider Info",
  async get(runtime, _message, state) {
    try {
      const polygonWalletProviderInstance = await initWalletProvider(runtime);
      if (!polygonWalletProviderInstance) {
        throw new Error(
          "Failed to initialize PolygonWalletProvider - check PRIVATE_KEY configuration"
        );
      }
      const agentAddress = polygonWalletProviderInstance.getAddress();
      if (!agentAddress) throw new Error("Could not determine agent address from provider");
      const polygonRpcService = runtime.getService(
        PolygonRpcService.serviceType
      );
      if (!polygonRpcService) {
        throw new Error("PolygonRpcService not available or not started");
      }
      const maticBalanceWei = await polygonRpcService.getBalance(agentAddress, "L2");
      const maticBalanceFormatted = ethers5.formatEther(maticBalanceWei);
      const gasEstimates = await getGasPriceEstimates(runtime);
      const agentName = state?.agentName || "The agent";
      let text = `${agentName}'s Polygon Status:\\n`;
      text += `  Wallet Address: ${agentAddress}\\n`;
      text += `  MATIC Balance: ${maticBalanceFormatted} MATIC\\n`;
      text += "  Current Gas Prices (Max Priority Fee Per Gas - Gwei):\\n";
      const safeLowGwei = gasEstimates.safeLow?.maxPriorityFeePerGas ? ethers5.formatUnits(gasEstimates.safeLow.maxPriorityFeePerGas, "gwei") : "N/A";
      const averageGwei = gasEstimates.average?.maxPriorityFeePerGas ? ethers5.formatUnits(gasEstimates.average.maxPriorityFeePerGas, "gwei") : "N/A";
      const fastGwei = gasEstimates.fast?.maxPriorityFeePerGas ? ethers5.formatUnits(gasEstimates.fast.maxPriorityFeePerGas, "gwei") : "N/A";
      const baseFeeGwei = gasEstimates.estimatedBaseFee ? ethers5.formatUnits(gasEstimates.estimatedBaseFee, "gwei") : "N/A";
      text += `    - Safe Low: ${safeLowGwei}\\n`;
      text += `    - Average:  ${averageGwei}\\n`;
      text += `    - Fast:     ${fastGwei}\\n`;
      text += `  Estimated Base Fee (Gwei): ${baseFeeGwei}\\n`;
      return {
        text,
        data: {
          address: agentAddress,
          maticBalance: maticBalanceFormatted,
          gasEstimates: {
            safeLowGwei,
            averageGwei,
            fastGwei,
            baseFeeGwei
          }
        },
        values: {
          // Provide raw values or formatted strings as needed
          address: agentAddress,
          maticBalance: maticBalanceFormatted,
          gas_safe_low_gwei: safeLowGwei,
          gas_average_gwei: averageGwei,
          // Changed key name
          gas_fast_gwei: fastGwei,
          gas_base_fee_gwei: baseFeeGwei
        }
      };
    } catch (error) {
      logger21.error("Error getting Polygon provider info:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const userMessage = errorMessage.includes("private key") ? "There was an issue with the wallet configuration. Please ensure PRIVATE_KEY is correctly set." : `Error getting Polygon provider info: ${errorMessage}`;
      return {
        text: userMessage,
        data: { error: errorMessage },
        values: { error: errorMessage }
      };
    }
  }
};
var polygonProviders = [polygonWalletProvider, polygonProviderInfo];
var polygonServices = [PolygonRpcService, HeimdallService];
var polygonPlugin = {
  name: "@elizaos/plugin-polygon",
  description: "Plugin for interacting with the Polygon PoS network and staking.",
  // Configuration loaded from environment/character settings
  config: {
    POLYGON_RPC_URL: process.env.POLYGON_RPC_URL,
    ETHEREUM_RPC_URL: process.env.ETHEREUM_RPC_URL,
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    POLYGONSCAN_KEY: process.env.POLYGONSCAN_KEY,
    HEIMDALL_RPC_URL: process.env.HEIMDALL_RPC_URL
  },
  // Initialization logic
  async init(config, runtime) {
    logger21.info(`Initializing plugin: ${this.name}`);
    try {
      const validatedConfig = await configSchema.parseAsync(config);
      logger21.info("Polygon plugin configuration validated successfully.");
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (!runtime.getSetting(key)) {
          logger21.warn(
            `Setting ${key} was validated but not found via runtime.getSetting. Ensure it is loaded globally before plugin init.`
          );
        }
      }
    } catch (error) {
      if (error instanceof z5.ZodError) {
        logger21.error("Invalid Polygon plugin configuration:", error.errors);
        throw new Error(
          `Invalid Polygon plugin configuration: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
        );
      }
      logger21.error("Error during Polygon plugin initialization:", error);
      throw error;
    }
  },
  // Register components
  actions: polygonActions,
  providers: polygonProviders,
  services: polygonServices,
  // Optional lifecycle methods, models, tests, routes, events
  models: {},
  tests: [],
  routes: [],
  events: {}
};
var index_default = polygonPlugin;
export {
  index_default as default,
  polygonPlugin
};
//# sourceMappingURL=index.js.map