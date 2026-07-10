import type { Dispatch, SetStateAction } from "react";
import type { User } from "@/types/user";
import { getUserById } from "./functions";

export function sameEthereumAddress(
    a: string | null | undefined,
    b: string | null | undefined
): boolean {
    const x = a?.trim().toLowerCase();
    const y = b?.trim().toLowerCase();
    if (!x || !y) {
        return false;
    }
    return x === y;
}

const MISMATCH_TOAST =
    "You are not authorized for this on-chain action. Connect the same wallet as in your GrumBuild profile (the address saved on your account).";

/**
 * Ensures the connected wallet matches the logged-in user's on-chain address.
 * If JWT/context has no address yet, loads it from the API and updates context (stale token after linking wallet).
 */
export async function ensureSignerMatchesSession(
    walletAddress: string | null | undefined,
    sessionUser: Pick<User, "id" | "address">,
    setUserInfo?: Dispatch<SetStateAction<User>>
): Promise<{ ok: true } | { ok: false; message: string }> {
    const w = walletAddress?.trim();
    if (!w) {
        return { ok: false, message: "Please connect your wallet to continue." };
    }

    let expected = sessionUser?.address?.trim();

    if (!expected && sessionUser?.id) {
        const res = await getUserById(sessionUser.id);
        if (res.success && res.data?.address?.trim()) {
            expected = res.data.address.trim();
            if (setUserInfo) {
                setUserInfo((prev) => ({ ...prev, address: expected! }));
            }
        }
    }

    if (!expected) {
        return {
            ok: false,
            message:
                "Your account has no wallet address on file. Log in with MetaMask, or add your wallet in Profile, then try again.",
        };
    }

    if (!sameEthereumAddress(w, expected)) {
        return { ok: false, message: MISMATCH_TOAST };
    }

    return { ok: true };
}
