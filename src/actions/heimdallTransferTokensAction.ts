import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  logger,
  composePromptFromState,
  ModelType,
  parseJSONObjectFromText,
  type ActionExample,
} from '@elizaos/core';
import { HeimdallService } from '../services/HeimdallService';
import { z } from 'zod';
import { heimdallTransferTokensActionTemplate } from '../templates'; // Will be created

// --- Action Parameter Schema ---
const heimdallTransferTokensParamsSchema = z.object({
  recipientAddress: z
    .string()
    .startsWith(
      'heimdallvaloper',
      'Recipient address must start with "heimdallvaloper" for validators or "heimdall" for regular addresses.'
    )
    .or(
      z
        .string()
        .startsWith(
          'heimdall',
          'Recipient address must start with "heimdallvaloper" for validators or "heimdall" for regular addresses.'
        )
    )
    .describe(
      'The Heimdall address of the recipient (must start with "heimdall" or "heimdallvaloper").'
    ),
  amount: z
    .string()
    .min(1)
    .regex(/^\d+$/, 'Amount must be a string containing only digits (Wei).')
    .describe('The amount of tokens to transfer in Wei (e.g., "1000000000000000000").'),
  denom: z
    .string()
    .optional()
    .default('matic')
    .describe('The denomination of the tokens (default: "matic").'),
});
type HeimdallTransferTokensParams = z.infer<typeof heimdallTransferTokensParamsSchema>;

// --- Helper to extract params from text ---
function extractHeimdallTransferTokensParamsFromText(
  text: string
): Partial<HeimdallTransferTokensParams> {
  const params: Partial<HeimdallTransferTokensParams> = {};
  logger.debug(`Attempting to extract HeimdallTransferTokensParams from text: \"${text}\".`);

  const recipientMatch = text.match(
    /\b(?:to|recipient|receiver)\s*[:\-]?\s*(heimdall(?:valoper)?[a-zA-Z0-9]+)/i
  );
  if (recipientMatch?.[1]) params.recipientAddress = recipientMatch[1];

  const amountMatch = text.match(/\b(amount|sum)\s*[:\-]?\s*(\d+)/i);
  if (amountMatch?.[2]) params.amount = amountMatch[2];

  const denomMatch = text.match(/\b(denom|denomination|currency)\s*[:\-]?\s*(\w+)/i);
  if (denomMatch?.[2]) params.denom = denomMatch[2].toLowerCase();

  logger.debug('Manually extracted HeimdallTransferTokensParams:', params);
  return params;
}

// --- Action Definition ---
export const heimdallTransferTokensAction: Action = {
  name: 'HEIMDALL_TRANSFER_TOKENS',
  similes: [
    'TRANSFER_HEIMDALL_MATIC',
    'SEND_HEIMDALL_TOKENS',
    'HEIMDALL_TOKEN_TRANSFER',
    'TRANSFER_TO_HEIMDALL',
    'SEND_TO_HEIMDALL',
    'HEIMDALL_TRANSFER',
    'TRANSFER_MATIC_HEIMDALL',
    'SEND_MATIC_HEIMDALL',
  ],
  description:
    'Transfers native tokens (e.g., MATIC) on the Heimdall network when the recipient address starts with "heimdall".',

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    logger.debug('Validating HEIMDALL_TRANSFER_TOKENS action...');
    const heimdallRpcUrl = runtime.getSetting('HEIMDALL_RPC_URL');
    const privateKey = runtime.getSetting('PRIVATE_KEY');

    if (!heimdallRpcUrl) {
      logger.error('HEIMDALL_RPC_URL is not configured.');
      return false;
    }
    if (!privateKey) {
      logger.error('PRIVATE_KEY is not configured.');
      return false;
    }
    logger.debug('HEIMDALL_TRANSFER_TOKENS validation successful.');
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options: unknown,
    callback: HandlerCallback | undefined
  ) => {
    logger.info(`Handling HEIMDALL_TRANSFER_TOKENS for message: ${message.id}`);
    const rawMessageText = message.content.text || '';
    let extractedParams: (Partial<HeimdallTransferTokensParams> & { error?: string }) | null = null;

    try {
      const heimdallService = runtime.getService<HeimdallService>(HeimdallService.serviceType);
      if (!heimdallService) {
        throw new Error('HeimdallService is not available.');
      }

      try {
        const prompt = composePromptFromState({
          state,
          template: heimdallTransferTokensActionTemplate,
        });
        const modelResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
          prompt,
        });
        const parsed = parseJSONObjectFromText(modelResponse);
        if (parsed) {
          extractedParams = parsed as Partial<HeimdallTransferTokensParams>;
        }
        logger.debug('HEIMDALL_TRANSFER_TOKENS: Extracted params via TEXT_SMALL:', extractedParams);
        if (extractedParams?.error) {
          throw new Error(extractedParams.error);
        }
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger.warn(
          `HEIMDALL_TRANSFER_TOKENS: Failed to parse JSON from model (Proceeding to manual): ${errorMsg}`
        );
      }

      if (
        !extractedParams ||
        extractedParams.error ||
        !extractedParams.recipientAddress ||
        !extractedParams.amount
      ) {
        logger.info(
          'HEIMDALL_TRANSFER_TOKENS: Model extraction insufficient, attempting manual extraction.'
        );
        const manualParams = extractHeimdallTransferTokensParamsFromText(rawMessageText);
        if (extractedParams && !extractedParams.error) {
          extractedParams = { ...manualParams, ...extractedParams };
        } else {
          extractedParams = manualParams;
        }
        logger.debug('HEIMDALL_TRANSFER_TOKENS: Params after manual extraction:', extractedParams);
      }

      const validatedParams = heimdallTransferTokensParamsSchema.safeParse(extractedParams);
      if (!validatedParams.success) {
        logger.error(
          'HEIMDALL_TRANSFER_TOKENS: Invalid parameters.',
          validatedParams.error.flatten()
        );
        throw new Error(
          `Invalid parameters: ${validatedParams.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`
        );
      }

      const { recipientAddress, amount, denom } = validatedParams.data;

      const txHash = await heimdallService.transferHeimdallTokens(recipientAddress, amount, denom);

      const successMsg = `Successfully transferred ${amount} ${denom || 'matic'} to ${recipientAddress} on Heimdall. Tx Hash: ${txHash}`;
      logger.info(successMsg);

      if (callback) {
        await callback({
          text: successMsg,
          content: {
            success: true,
            transactionHash: txHash,
            recipientAddress,
            amount,
            denom,
          },
          actions: [heimdallTransferTokensAction.name],
          source: message.content.source,
        });
      }
      return {
        success: true,
        transactionHash: txHash,
        recipientAddress,
        amount,
        denom,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in HEIMDALL_TRANSFER_TOKENS handler:', errMsg, error);
      if (callback) {
        await callback({
          text: `Error transferring Heimdall tokens: ${errMsg}`,
          actions: [heimdallTransferTokensAction.name],
          source: message.content.source,
        });
      }
      return { success: false, error: errMsg };
    }
  },

  examples: [
    [
      {
        name: 'User transfers Heimdall MATIC',
        id: 'htt-ex1-user',
        role: 'user',
        entityId: 'u1',
        roomId: 'r1',
        timestamp: new Date().toISOString(),
        actions: ['HEIMDALL_TRANSFER_TOKENS'],
        content: {
          text: 'Send 0.5 MATIC on Heimdall to heimdall1recipientaddress. The amount is 500000000000000000 in wei.',
          source: 'user-input',
        },
      } as ActionExample,
    ],
    [
      {
        name: 'User transfers Heimdall tokens with different denom',
        id: 'htt-ex2-user',
        role: 'user',
        entityId: 'u1',
        roomId: 'r1',
        timestamp: new Date().toISOString(),
        actions: ['HEIMDALL_TRANSFER_TOKENS'],
        content: {
          text: 'Transfer 100000 uatom on Heimdall to heimdallvaloper1validatoraddress.',
          source: 'user-input',
        },
      } as ActionExample,
    ],
  ],
};
