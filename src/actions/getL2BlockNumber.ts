import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type Content,
  logger,
} from '@elizaos/core';
import { PolygonRpcService } from '../services/PolygonRpcService.js';

export const getL2BlockNumberAction: Action = {
  name: 'GET_L2_BLOCK_NUMBER',
  similes: ['GET_POLYGON_BLOCK_NUMBER', 'CHECK_CURRENT_BLOCK', 'SHOW_LATEST_BLOCK'],
  description: 'Gets the current block number on Polygon (L2).',
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    const content = message.content?.text?.toLowerCase() || '';

    // Add debug logging to see if this is being called
    logger.info(`[getL2BlockNumberAction] Validating message: "${content}"`);

    // Check for block number related keywords
    const blockNumberKeywords = [
      'block number',
      'current block',
      'latest block',
      'polygon block number',
      'get polygon block',
      'block height',
      'current polygon block',
      'latest polygon block',
      'get polygon block number',
      'show polygon block number',
    ];

    const matches = blockNumberKeywords.some((keyword) => content.includes(keyword));
    logger.info(`[getL2BlockNumberAction] Validation result: ${matches}`);

    return matches;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<Content> => {
    logger.info('[getL2BlockNumberAction] Handler called!');

    const rpcService = runtime.getService<PolygonRpcService>(PolygonRpcService.serviceType);
    if (!rpcService) {
      throw new Error('PolygonRpcService not available');
    }

    try {
      const blockNumber = await rpcService.getCurrentBlockNumber();

      const responseContent: Content = {
        text: `The current Polygon block number is ${blockNumber}.`,
        actions: ['GET_L2_BLOCK_NUMBER'],
        data: {
          blockNumber,
          network: 'polygon',
          timestamp: Date.now(),
        },
      };

      if (callback) {
        await callback(responseContent);
      }

      return responseContent;
    } catch (error) {
      logger.error('Error getting L2 block number:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      const errorContent: Content = {
        text: `Error retrieving current Polygon block number: ${errorMessage}`,
        actions: ['GET_L2_BLOCK_NUMBER'],
        data: { error: errorMessage },
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
        name: 'user',
        content: {
          text: 'get polygon block number',
        },
      },
      {
        name: 'assistant',
        content: {
          text: 'The current Polygon block number is 65123456.',
          actions: ['GET_L2_BLOCK_NUMBER'],
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: 'what is the current block number on polygon?',
        },
      },
      {
        name: 'assistant',
        content: {
          text: 'The current Polygon block number is 65123456.',
          actions: ['GET_L2_BLOCK_NUMBER'],
        },
      },
    ],
  ],
};
