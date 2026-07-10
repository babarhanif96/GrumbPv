'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  connectWallet,
  disconnectMetaMaskSdk,
  getEthereumProvider,
  getMetaMaskPreferredEthereum,
  getMetaMaskSdkProvider,
  isMobileWalletAvailable,
  type MetaMaskProvider,
} from "@/utils/walletConnnect";
import {
  persistWalletSession,
  readPersistedChainId,
  readPersistedWalletAddress,
} from "@/utils/walletPersistence";

type WalletTransaction = {
  to: string;
  value?: string; // expected hex wei string (0x...) or decimal wei to be normalized
  data?: string;
  gas?: string; // hex or decimal, will be normalized
  gasPrice?: string; // hex or decimal, will be normalized
  chainId?: number | string; // optional override
};

type WalletTransactionResult = {
  hash: string | null;
  error: string | null;
};

type WalletContextValue = {
  address: string | null;
  chainId: string | null;
  provider: MetaMaskProvider | null;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  connect: (email?: string) => Promise<{ address: string; chainId: string } | null>;
  /** True when MetaMask SDK mobile path is available. */
  isMobileWalletAvailable: boolean;
  disconnect: () => void;
  sendTransaction: (tx: WalletTransaction) => Promise<WalletTransactionResult>;
};

const defaultContext: WalletContextValue = {
  address: null,
  chainId: null,
  provider: null,
  isConnecting: false,
  isConnected: false,
  error: null,
  connect: async () => null,
  disconnect: () => {},
  sendTransaction: async () => ({
    hash: null,
    error: "Wallet not connected",
  }),
  isMobileWalletAvailable: false,
};

export const WalletCtx = createContext<WalletContextValue>(defaultContext);

type Props = {
  children: ReactNode;
};

export const WalletProvider = ({ children }: Props) => {
  const [provider, setProvider] = useState<MetaMaskProvider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = useMemo(() => Boolean(address), [address]);

  const disconnect = useCallback(() => {
    disconnectMetaMaskSdk();
    persistWalletSession(null);
    setProvider(null);
    setAddress(null);
    setChainId(null);
    setError(null);
  }, []);

  // Restore last session from localStorage before paint so route changes / remounts do not flash "disconnected".
  useLayoutEffect(() => {
    const storedAddr = readPersistedWalletAddress();
    const storedChain = readPersistedChainId();
    if (storedAddr) {
      setAddress(storedAddr);
    }
    if (storedChain) {
      setChainId(storedChain);
    }
  }, []);

  // Restore injected (MetaMask) session on mount — prefer MetaMask when multiple wallets share `window.ethereum`.
  useEffect(() => {
    const eth = getMetaMaskPreferredEthereum() ?? getEthereumProvider();
    if (!eth) {
      return;
    }
    setProvider(eth);

    const syncFromWallet = () => {
      void Promise.all([
        eth.request({ method: "eth_accounts" }),
        eth.request({ method: "eth_chainId" }),
      ])
        .then(([accounts, chain]) => {
          const accountList = accounts as string[];
          const cid = chain as string;
          setChainId(cid);
          if (accountList?.length) {
            const a = accountList[0];
            setAddress(a);
            persistWalletSession(a, cid);
            return;
          }
          const stored = readPersistedWalletAddress();
          if (stored) {
            setAddress(stored);
            persistWalletSession(stored, cid);
          } else {
            setAddress(null);
            persistWalletSession(null);
          }
        })
        .catch((err) => {
          console.warn("Failed to sync wallet from provider", err);
        });
    };

    syncFromWallet();
    // Extension sometimes injects after first paint; second read reduces false "disconnected" on refresh.
    const retryTimer = window.setTimeout(syncFromWallet, 400);

    const handleAccountsChanged = (accounts: unknown) => {
      const accountList = accounts as string[] | undefined;
      if (accountList && accountList.length > 0) {
        const a = accountList[0];
        setAddress(a);
        void eth
          .request({ method: "eth_chainId" })
          .then((cid) => {
            const chain = cid as string;
            setChainId(chain);
            persistWalletSession(a, chain);
          })
          .catch(() => {
            persistWalletSession(a);
          });
        return;
      }
      // MetaMask can emit [] briefly on reload; confirm with eth_accounts before clearing session.
      void eth
        .request({ method: "eth_accounts" })
        .then((latest) => {
          const list = latest as string[];
          if (list?.length) {
            const a = list[0];
            setAddress(a);
            void eth
              .request({ method: "eth_chainId" })
              .then((cid) => {
                const chain = cid as string;
                setChainId(chain);
                persistWalletSession(a, chain);
              })
              .catch(() => persistWalletSession(a));
            return;
          }
          disconnect();
        })
        .catch(() => {
          disconnect();
        });
    };

    const handleChainChanged = (nextChainId: unknown) => {
      if (typeof nextChainId === "string") {
        setChainId(nextChainId);
        const stored = readPersistedWalletAddress();
        if (stored) {
          persistWalletSession(stored, nextChainId);
        }
      }
    };

    eth.on?.("accountsChanged", handleAccountsChanged);
    eth.on?.("chainChanged", handleChainChanged);

    return () => {
      window.clearTimeout(retryTimer);
      eth.removeListener?.("accountsChanged", handleAccountsChanged);
      eth.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [disconnect]);

  const connect = useCallback(async (email?: string) => {
    const eth = getMetaMaskPreferredEthereum() ?? getEthereumProvider();
    const useInjected = eth?.isMetaMask;
    if (!useInjected && !isMobileWalletAvailable()) {
      setError("No wallet available. Install MetaMask to continue.");
      return null;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const result = await connectWallet(email);
      if (!result) return null;

      if (result.via === "injected") {
        setProvider(getMetaMaskPreferredEthereum() ?? getEthereumProvider() ?? null);
      } else {
        setProvider(getMetaMaskSdkProvider());
      }
      setAddress(result.address);
      setChainId(result.chainId);
      persistWalletSession(result.address, result.chainId);
      return { address: result.address, chainId: result.chainId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet.";
      setError(message);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const sendTransaction = useCallback(
    async (tx: WalletTransaction): Promise<WalletTransactionResult> => {
      const normalizeHex = (raw?: string) => {
        if (!raw) return undefined;
        if (raw.startsWith("0x") || raw.startsWith("0X")) return raw;
        try {
          return `0x${BigInt(raw).toString(16)}`;
        } catch {
          return raw;
        }
      };

      const eth = provider ?? getMetaMaskPreferredEthereum() ?? getEthereumProvider();
      if (!eth) {
        throw new Error("Wallet provider not available. Connect MetaMask first.");
      }
      if (!address) {
        throw new Error("No connected account. Connect MetaMask first.");
      }

      const value = normalizeHex(tx.value);
      const gas = normalizeHex(tx.gas);
      const gasPrice = normalizeHex(tx.gasPrice);
      const txChainId = tx.chainId ?? chainId;
      const normalizedChainId =
        typeof txChainId === "number"
          ? `0x${txChainId.toString(16)}`
          : txChainId;

      const txParams = {
        from: address,
        ...tx,
        value,
        gas,
        gasPrice,
        chainId: normalizedChainId,
      };

      let hash: string | undefined;
      try {
        hash = (await eth.request({
          method: "eth_sendTransaction",
          params: [txParams],
        })) as string | undefined;
      } catch (err) {
        // User rejected the transaction or there was an RPC error.
        console.warn("Failed to send transaction", err);
        const message =
          (err as any)?.code === 4001
            ? "User rejected the transaction in MetaMask."
            : err instanceof Error
            ? err.message
            : "Failed to send transaction.";
        return { hash: null, error: message };
      }

      if (!hash) {
        return { hash: null, error: "Failed to obtain transaction hash." };
      }

      // Wait for the transaction receipt and ensure it was successful.
      const maxAttempts = 30;
      const delayMs = 2000;
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));

      let receipt: any = null;
      for (let i = 0; i < maxAttempts; i++) {
        try {
          receipt = await eth.request({
            method: "eth_getTransactionReceipt",
            params: [hash],
          });
        } catch (err) {
          console.warn("Failed to fetch transaction receipt", err);
          const message =
            err instanceof Error
              ? err.message
              : "Failed to fetch transaction receipt.";
          return { hash: null, error: message };
        }

        if (receipt) break;
        await sleep(delayMs);
      }

      if (!receipt) {
        console.warn("Transaction receipt not found within timeout", hash);
        return {
          hash: null,
          error: "Transaction not mined within the expected time.",
        };
      }

      const status = (receipt as any).status;
      const isSuccess =
        status === "0x1" || status === 1 || status === true;

      if (!isSuccess) {
        console.warn("Transaction failed on-chain", { hash, receipt });
        return {
          hash: null,
          error: "Transaction failed on-chain.",
        };
      }

      return { hash, error: null };
    },
    [address, chainId, provider]
  );

  return (
    <WalletCtx.Provider
      value={{
        address,
        chainId,
        provider,
        isConnecting,
        isConnected,
        error,
        connect,
        disconnect,
        sendTransaction,
        isMobileWalletAvailable: isMobileWalletAvailable(),
      }}
    >
      {children}
    </WalletCtx.Provider>
  );
};

export const useWallet = () => useContext(WalletCtx);


