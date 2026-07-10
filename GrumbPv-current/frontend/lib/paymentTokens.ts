export const ESCROW_PAYMENT_SYMBOLS = ['BNB', 'USDT', 'USDC'] as const;

export type EscrowPaymentSymbol = (typeof ESCROW_PAYMENT_SYMBOLS)[number];

export function normalizeEscrowPaymentSymbol(symbol: string | undefined | null): EscrowPaymentSymbol {
  const u = (symbol || 'BNB').toUpperCase();
  return (ESCROW_PAYMENT_SYMBOLS as readonly string[]).includes(u) ? (u as EscrowPaymentSymbol) : 'BNB';
}
