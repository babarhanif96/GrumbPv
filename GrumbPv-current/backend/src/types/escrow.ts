export interface EscrowTxData {
  to: string;
  data: string;
  value: string;
  chainId: number;
  cid?: string;
  approvalTx?: {
    to: string;
    data: string;
    value: string;
    chainId: number;
  };
}
