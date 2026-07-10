/** Last wallet session for UI restore across navigations / remounts (not a secret). */
const LS_ADDRESS = "grumbpv_connected_wallet_address";
const LS_CHAIN = "grumbpv_connected_wallet_chain_id";

export function readPersistedWalletAddress(): string | null {
    if (typeof window === "undefined") {
        return null;
    }
    try {
        const v = localStorage.getItem(LS_ADDRESS);
        return v?.trim() || null;
    } catch {
        return null;
    }
}

export function readPersistedChainId(): string | null {
    if (typeof window === "undefined") {
        return null;
    }
    try {
        const v = localStorage.getItem(LS_CHAIN);
        return v?.trim() || null;
    } catch {
        return null;
    }
}

export function persistWalletSession(address: string | null, chainId?: string | null): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        if (address?.trim()) {
            localStorage.setItem(LS_ADDRESS, address.trim());
            if (chainId?.trim()) {
                localStorage.setItem(LS_CHAIN, chainId.trim());
            }
        } else {
            localStorage.removeItem(LS_ADDRESS);
            localStorage.removeItem(LS_CHAIN);
        }
    } catch {
        // private mode / quota
    }
}
