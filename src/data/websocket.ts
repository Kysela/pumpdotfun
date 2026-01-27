// =========================================================
// SOLANA WEBSOCKET — PUMP.FUN TRANSACTION STREAM
// =========================================================

import WebSocket from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import * as bs58 from 'bs58';
import { Transaction } from '../types';
import { PUMP_FUN_PROGRAM_ID, RPC_CONFIG } from '../config';
import { logger } from '../utils/logger';
import { events } from '../utils/eventEmitter';

/**
 * Solana WebSocket client for streaming pump.fun transactions
 */
export class SolanaWebSocket {
  private ws: WebSocket | null = null;
  private connection: Connection;
  private subscriptionId: number | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000;
  private isConnected: boolean = false;
  private messageId: number = 1;
  private pendingCallbacks: Map<number, (result: unknown) => void> = new Map();

  constructor() {
    this.connection = new Connection(RPC_CONFIG.httpEndpoint, 'confirmed');
  }

  /**
   * Connect to Solana WebSocket and subscribe to pump.fun logs
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logger.info('Connecting to Solana WebSocket...', { endpoint: RPC_CONFIG.wsEndpoint });
        
        this.ws = new WebSocket(RPC_CONFIG.wsEndpoint);

        this.ws.on('open', () => {
          logger.info('WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.subscribeToPumpFun();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          logger.error('WebSocket error', { error: error.message });
          if (!this.isConnected) {
            reject(error);
          }
        });

        this.ws.on('close', () => {
          logger.warn('WebSocket closed');
          this.isConnected = false;
          this.handleReconnect();
        });

      } catch (error) {
        logger.error('Failed to create WebSocket', { error });
        reject(error);
      }
    });
  }

  /**
   * Subscribe to pump.fun program logs
   */
  private subscribeToPumpFun(): void {
    const subscribeMessage = {
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'logsSubscribe',
      params: [
        { mentions: [PUMP_FUN_PROGRAM_ID] },
        { commitment: 'confirmed' }
      ]
    };

    const id = subscribeMessage.id;
    this.pendingCallbacks.set(id, (result) => {
      this.subscriptionId = result as number;
      logger.info('Subscribed to pump.fun logs', { subscriptionId: this.subscriptionId });
    });

    this.send(subscribeMessage);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Handle subscription confirmation
      if (message.id && this.pendingCallbacks.has(message.id)) {
        const callback = this.pendingCallbacks.get(message.id)!;
        this.pendingCallbacks.delete(message.id);
        callback(message.result);
        return;
      }

      // Handle log notifications
      if (message.method === 'logsNotification') {
        this.processLogNotification(message);
      }
    } catch (error) {
      logger.error('Failed to parse WebSocket message', { error });
    }
  }

  /**
   * Process a log notification from the subscription
   */
  private async processLogNotification(message: any): Promise<void> {
    try {
      const { value } = message.params.result;
      const { signature, err, logs } = value;

      // Skip failed transactions
      if (err) return;

      // Check if this is a BUY transaction
      if (!this.isBuyTransaction(logs)) return;

      // Parse the transaction details
      const txDetails = await this.parseTransaction(signature, logs);
      if (txDetails) {
        logger.debug('Buy transaction detected', { 
          token: txDetails.tokenAddress.slice(0, 8),
          buyer: txDetails.buyerWallet.slice(0, 8),
          sol: txDetails.solAmount
        });
        events.emit('transaction', txDetails);
      }
    } catch (error) {
      logger.error('Failed to process log notification', { error });
    }
  }

  /**
   * Check if logs indicate a BUY transaction
   */
  private isBuyTransaction(logs: string[]): boolean {
    // Look for pump.fun buy instruction patterns
    const buyIndicators = [
      'Program log: Instruction: Buy',
      'buy',
    ];

    const logString = logs.join(' ').toLowerCase();
    
    // Must have buy instruction and NOT be a sell
    const hasBuy = buyIndicators.some(indicator => 
      logString.includes(indicator.toLowerCase())
    );
    const hasSell = logString.includes('sell');

    return hasBuy && !hasSell;
  }

  /**
   * Parse transaction details from signature
   */
  private async parseTransaction(signature: string, logs: string[]): Promise<Transaction | null> {
    try {
      // Fetch full transaction details
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx || !tx.meta) return null;

      // Extract relevant data
      const timestamp = tx.blockTime ? tx.blockTime * 1000 : Date.now();
      
      // Find the buyer wallet (fee payer is typically the buyer)
      const buyerWallet = tx.transaction.message.accountKeys[0].pubkey.toBase58();

      // Calculate SOL amount from balance changes
      const preBalances = tx.meta.preBalances;
      const postBalances = tx.meta.postBalances;
      const solChange = (preBalances[0] - postBalances[0]) / 1e9; // Convert lamports to SOL

      // Extract token address from logs or accounts
      const tokenAddress = this.extractTokenAddress(tx, logs);
      if (!tokenAddress) return null;

      // Filter out very small amounts (likely not actual buys)
      if (solChange < 0.001) return null;

      return {
        tokenAddress,
        timestamp,
        buyerWallet,
        solAmount: Math.abs(solChange),
        txHash: signature,
      };
    } catch (error) {
      logger.debug('Failed to parse transaction', { signature, error });
      return null;
    }
  }

  /**
   * Extract token mint address from transaction
   */
  private extractTokenAddress(tx: any, logs: string[]): string | null {
    try {
      // Look for token mint in account keys
      const accounts = tx.transaction.message.accountKeys;
      
      // The token mint is typically one of the accounts that's not a known program
      const knownPrograms = [
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
        '11111111111111111111111111111111',              // System Program
        PUMP_FUN_PROGRAM_ID,                             // Pump.fun
        'SysvarRent111111111111111111111111111111111',  // Rent
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token
      ];

      // Find potential token mints (accounts that aren't programs and aren't the buyer)
      for (const account of accounts) {
        const pubkey = account.pubkey.toBase58();
        if (!knownPrograms.includes(pubkey) && 
            pubkey !== tx.transaction.message.accountKeys[0].pubkey.toBase58()) {
          // Simple heuristic: token addresses on pump.fun have specific patterns
          // For now, return the first non-program account that looks like a mint
          if (this.looksLikeTokenMint(pubkey)) {
            return pubkey;
          }
        }
      }

      // Fallback: try to extract from logs
      for (const log of logs) {
        const mintMatch = log.match(/mint: ([A-Za-z0-9]{32,44})/);
        if (mintMatch) {
          return mintMatch[1];
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Basic check if a pubkey looks like a token mint
   */
  private looksLikeTokenMint(pubkey: string): boolean {
    // Token mints are 32-44 characters of base58
    return pubkey.length >= 32 && pubkey.length <= 44;
  }

  /**
   * Handle reconnection logic
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    logger.info(`Reconnecting in ${delay}ms...`, { attempt: this.reconnectAttempts });
    
    setTimeout(() => {
      this.connect().catch(error => {
        logger.error('Reconnection failed', { error });
      });
    }, delay);
  }

  /**
   * Send a message through WebSocket
   */
  private send(message: object): void {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.ws) {
      // Unsubscribe first
      if (this.subscriptionId !== null) {
        this.send({
          jsonrpc: '2.0',
          id: this.messageId++,
          method: 'logsUnsubscribe',
          params: [this.subscriptionId]
        });
      }

      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      logger.info('WebSocket disconnected');
    }
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }
}
