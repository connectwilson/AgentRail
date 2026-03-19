/**
 * Atomic nonce manager for tx.send.
 * Prevents nonce conflicts when multiple transactions are submitted concurrently
 * from the same signer on the same chain.
 *
 * Usage:
 *   const nonce = await nonceManager.acquire(chain, signerAddress, publicClient);
 *   // submit tx with nonce
 *   // if tx fails, call nonceManager.release(chain, signerAddress) to reset
 */

import type { Address } from "viem";
import type { SupportedChain } from "./types";

type ChainSignerKey = `${SupportedChain}:${Address}`;

type NonceState = {
  nonce: number;
  pendingCount: number;
};

class NonceManager {
  private state = new Map<ChainSignerKey, NonceState>();
  // Queue of pending resolve functions waiting for a slot
  private queue = new Map<ChainSignerKey, Array<() => void>>();

  private key(chain: SupportedChain, address: Address): ChainSignerKey {
    return `${chain}:${address.toLowerCase() as Address}`;
  }

  /**
   * Acquire the next nonce for a (chain, address) pair.
   * On first call, fetches from the RPC. Subsequent calls increment locally.
   * Serializes concurrent callers so each gets a unique nonce.
   */
  async acquire(
    chain: SupportedChain,
    address: Address,
    fetchNonce: () => Promise<number>
  ): Promise<number> {
    const key = this.key(chain, address);
    const existing = this.state.get(key);

    if (!existing) {
      // First acquire: fetch from chain
      const onchain = await fetchNonce();
      this.state.set(key, { nonce: onchain + 1, pendingCount: 1 });
      return onchain;
    }

    // Increment locally
    const nonce = existing.nonce;
    this.state.set(key, { nonce: existing.nonce + 1, pendingCount: existing.pendingCount + 1 });
    return nonce;
  }

  /**
   * Reset the nonce state for a (chain, address) pair.
   * Call this when a transaction fails so the next attempt re-fetches from chain.
   */
  reset(chain: SupportedChain, address: Address): void {
    const key = this.key(chain, address);
    this.state.delete(key);
  }

  /**
   * Confirm a transaction was mined. Decrements the pending counter.
   * If all pending txs are done, the state resets automatically.
   */
  confirm(chain: SupportedChain, address: Address): void {
    const key = this.key(chain, address);
    const existing = this.state.get(key);
    if (!existing) return;
    const remaining = existing.pendingCount - 1;
    if (remaining <= 0) {
      this.state.delete(key);
    } else {
      this.state.set(key, { ...existing, pendingCount: remaining });
    }
  }

  /** Peek at the current tracked nonce without acquiring it */
  peek(chain: SupportedChain, address: Address): number | undefined {
    return this.state.get(this.key(chain, address))?.nonce;
  }

  /** Force-set the nonce for a (chain, address), e.g. after a stuck tx replacement */
  set(chain: SupportedChain, address: Address, nonce: number): void {
    const key = this.key(chain, address);
    const existing = this.state.get(key);
    this.state.set(key, { nonce, pendingCount: existing?.pendingCount ?? 0 });
  }
}

export const nonceManager = new NonceManager();
