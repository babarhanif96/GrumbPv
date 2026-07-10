import { ethers } from 'ethers';
import { BLOCKCHAIN_CONFIG, CONTRACT_ABIS, CONTRACT_ADDRESSES, resolvePaymentTokenConfig } from '../../config/contracts.js';
import { web3Provider } from '../../utils/web3Provider.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { jobMilestoneService } from '../database/job.milestone.service.js';
import { chainTxsService } from '../database/chainTxs.service.js';
import { jobService } from '../database/job.service.js';
import { EscrowTxData } from '../../types/escrow.js';
import { userService } from '../database/user.service.js';
import { notificationService } from '../database/notification.service.js';
import { notification_entity, notification_type } from '@prisma/client';

export interface EscrowInfo {
  buyer: string;
  vendor: string;
  arbiter: string;
  feeRecipient: string;
  paymentToken: string;
  rewardToken: string;
  rewardRatePer1e18: bigint;
  amount: bigint;
  buyerFeeReserve: bigint;
  disputeFeeAmount: bigint;
  buyerFeeBps: bigint;
  vendorFeeBps: bigint;
  disputeFeeBps: bigint;
  rewardRateBps: bigint;
  createdAt: bigint;
  fundedAt: bigint;
  deadline: bigint;
  disputeFeeDeadline: bigint;
  disputeInitiator: string;
  buyerPaidDisputeFee: boolean;
  vendorPaidDisputeFee: boolean;
  cid: string;
  contentHash: string;
  proposedCID: string;
  proposedContentHash: string;
  buyerApproved: boolean;
  vendorApproved: boolean;
  state: number;
}

export class EscrowService {
  /**
   * Get escrow contract instance
   */
  private getEscrowContract(escrowAddress: string, signer?: ethers.Wallet): ethers.Contract {
    if (!escrowAddress || escrowAddress === '') {
      throw new AppError('Escrow address is required', 400, 'ESCROW_ADDRESS_REQUIRED');
    }

    if (!ethers.isAddress(escrowAddress)) {
      throw new AppError('Invalid escrow address format', 400, 'INVALID_ESCROW_ADDRESS');
    }

    const provider = web3Provider.getProvider();
    return new ethers.Contract(escrowAddress, CONTRACT_ABIS.Escrow, signer || provider);
  }

  /**
   * Get all escrow information
   */
  async getEscrowInfo(escrowAddress: string): Promise<EscrowInfo> {
    try {
      const contract = this.getEscrowContract(escrowAddress);
      const info = await contract.getAllInfo();

      logger.info(`Fetched escrow info for ${escrowAddress}`);

      return {
        buyer: info.buyer,
        vendor: info.vendor,
        arbiter: info.arbiter,
        feeRecipient: info.feeRecipient,
        paymentToken: info.paymentToken,
        rewardToken: info.rewardToken,
        rewardRatePer1e18: info.rewardRatePer1e18,
        amount: info.amount,
        buyerFeeReserve: info.buyerFeeReserve,
        disputeFeeAmount: info.disputeFeeAmount,
        buyerFeeBps: info.buyerFeeBps,
        vendorFeeBps: info.vendorFeeBps,
        disputeFeeBps: info.disputeFeeBps,
        rewardRateBps: info.rewardRateBps,
        createdAt: info.createdAt,
        fundedAt: info.fundedAt,
        deadline: info.deadline,
        disputeFeeDeadline: info.disputeFeeDeadline,
        disputeInitiator: info.disputeInitiator,
        buyerPaidDisputeFee: info.buyerPaidDisputeFee,
        vendorPaidDisputeFee: info.vendorPaidDisputeFee,
        cid: info.cid,
        contentHash: info.contentHash,
        proposedCID: info.proposedCID,
        proposedContentHash: info.proposedContentHash,
        buyerApproved: info.buyerApproved,
        vendorApproved: info.vendorApproved,
        state: info.state,
      };
    } catch (error: any) {
      logger.error('Error fetching escrow info:', error);
      throw new AppError(`Failed to fetch escrow info: ${error.message}`, 500);
    }
  }

  /**
   * Fund escrow (buyer)
   */
  async fundEscrow(job_milestone_id: string, privateKey: string, value: string): Promise<string> {
    try {
      const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
      if (!exsitingJobMilestone) {
        throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
      }

      const escrowAddress = exsitingJobMilestone.escrow;
      if (!escrowAddress) {
        throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
      }

      const existingJob = await jobService.getJobById(exsitingJobMilestone.job_id);
      if (!existingJob) {
        throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
      }

      const wallet = web3Provider.getWallet(privateKey);
      const contract = this.getEscrowContract(escrowAddress, wallet);

      logger.info(`Funding escrow ${escrowAddress} with ${value} BNB`);

      const tx = await contract.fund({
        value: ethers.parseEther(value),
        gasLimit: 500000,
      });

      await tx.wait();

      logger.info(`Escrow funded successfully: ${tx.hash}`);

      await jobMilestoneService.updateJobMilestone(job_milestone_id, {
        status: 'funded',
      });

      await chainTxsService.createChainTx(
        'fund_escrow',
        BLOCKCHAIN_CONFIG.chainId,
        job_milestone_id,
        wallet.address,
        escrowAddress,
        tx.hash,
        'success',
        existingJob.client_id
      );

      return tx.hash;
    } catch (error: any) {
      logger.error('Error funding escrow:', error);
      throw new AppError(`Failed to fund escrow: ${error.message}`, 500);
    }
  }

  async buildFundEscrowTx(
    job_milestone_id: string,
    userId: string,
    chainId: number
  ): Promise<EscrowTxData> {
    const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
    if (!exsitingJobMilestone) {
      throw new AppError('Job milestone not found', 404);
    }

    const amount = exsitingJobMilestone.amount.toString();
    const tokenConfig = resolvePaymentTokenConfig(exsitingJobMilestone.token_symbol || 'BNB');

    const escrowAddress = exsitingJobMilestone.escrow;
    if (!escrowAddress) {
      throw new AppError('Escrow not found', 404);
    }

    const existingJob = await jobService.getJobById(exsitingJobMilestone.job_id);
    if (!existingJob) {
      throw new AppError('Job not found', 404);
    }

    // OPTIONAL: enforce who can fund
    if (existingJob.client_id !== userId) {
      throw new AppError('Unauthorized', 403);
    }

    const iface = new ethers.Interface(CONTRACT_ABIS.Escrow);

    const data = iface.encodeFunctionData('fund', []);
    const fundingValue =
      tokenConfig.address === 'native'
        ? ethers.parseEther(amount).toString()
        : '0';

    const txData: EscrowTxData = {
      to: escrowAddress,
      data,
      value: fundingValue,
      chainId: chainId,
    };

    if (tokenConfig.address !== 'native') {
      const erc20Iface = new ethers.Interface(CONTRACT_ABIS.ERC20);
      txData.approvalTx = {
        to: tokenConfig.address,
        data: erc20Iface.encodeFunctionData('approve', [
          escrowAddress,
          ethers.parseUnits(amount, tokenConfig.decimals),
        ]),
        value: '0',
        chainId,
      };
    }

    return txData;
  }

  /**
   * Deliver work (vendor)
   */
  async deliverWork(
    job_milestone_id: string,
    privateKey: string,
    cid: string,
    contentHash?: string
  ): Promise<string> {
    try {
      const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
      if (!exsitingJobMilestone) {
        throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
      }

      const escrowAddress = exsitingJobMilestone.escrow;
      if (!escrowAddress) {
        throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
      }

      const wallet = web3Provider.getWallet(privateKey);
      const contract = this.getEscrowContract(escrowAddress, wallet);

      // Convert contentHash to bytes32 format
      // contentHash should already be a 32-byte keccak256 hash from the controller
      let hashBytes: string;
      if (contentHash) {
        try {
          // Validate and convert to bytes32
          const hashBytesArray = ethers.getBytes(contentHash);

          if (hashBytesArray.length !== 32) {
            logger.warn(
              `contentHash is not 32 bytes (${hashBytesArray.length} bytes), padding/truncating`
            );
            if (hashBytesArray.length > 32) {
              // Truncate to first 32 bytes
              hashBytes = ethers.hexlify(hashBytesArray.slice(0, 32));
            } else {
              // Pad to 32 bytes
              hashBytes = ethers.zeroPadValue(ethers.hexlify(hashBytesArray), 32);
            }
          } else {
            // Already 32 bytes, use as-is
            hashBytes = ethers.hexlify(hashBytesArray);
          }
        } catch (error) {
          logger.warn(`Invalid contentHash format, using ZeroHash: ${contentHash}`);
          hashBytes = ethers.ZeroHash;
        }
      } else {
        hashBytes = ethers.ZeroHash;
      }

      logger.info(`Delivering work for escrow ${escrowAddress}, CID: ${cid}`);

      const tx = await contract.deliver(cid, hashBytes, { gasLimit: 500000 });
      await tx.wait();

      logger.info(`Work delivered successfully: ${tx.hash}`);

      await jobMilestoneService.updateJobMilestone(job_milestone_id, {
        status: 'delivered',
      });

      await chainTxsService.createChainTx(
        'deliver_work',
        BLOCKCHAIN_CONFIG.chainId,
        job_milestone_id,
        wallet.address,
        escrowAddress,
        tx.hash,
        'success',
        exsitingJobMilestone.freelancer_id
      );

      return tx.hash;
    } catch (error: any) {
      logger.error('Error delivering work:', error);
      throw new AppError(`Failed to deliver work: ${error.message}`, 500);
    }
  }

  async buildDeliverWorkTx(
    job_milestone_id: string,
    userId: string,
    chainId: number,
    cid: string,
    contentHash?: string
  ): Promise<EscrowTxData> {
    const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
    if (!exsitingJobMilestone) {
      throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
    }

    const escrowAddress = exsitingJobMilestone.escrow;
    if (!escrowAddress) {
      throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
    }

    // OPTIONAL: enforce who can deliver
    if (exsitingJobMilestone.freelancer_id !== userId) {
      throw new AppError('Unauthorized', 403);
    }

    // Convert contentHash to bytes32 format
    // contentHash should already be a 32-byte keccak256 hash from the controller
    let hashBytes: string;
    if (contentHash) {
      try {
        // Validate and convert to bytes32
        const hashBytesArray = ethers.getBytes(contentHash);

        if (hashBytesArray.length !== 32) {
          logger.warn(
            `contentHash is not 32 bytes (${hashBytesArray.length} bytes), padding/truncating`
          );
          if (hashBytesArray.length > 32) {
            // Truncate to first 32 bytes
            hashBytes = ethers.hexlify(hashBytesArray.slice(0, 32));
          } else {
            // Pad to 32 bytes
            hashBytes = ethers.zeroPadValue(ethers.hexlify(hashBytesArray), 32);
          }
        } else {
          // Already 32 bytes, use as-is
          hashBytes = ethers.hexlify(hashBytesArray);
        }
      } catch (error) {
        logger.warn(`Invalid contentHash format, using ZeroHash: ${contentHash}`);
        hashBytes = ethers.ZeroHash;
      }
    } else {
      hashBytes = ethers.ZeroHash;
    }

    const iface = new ethers.Interface(CONTRACT_ABIS.Escrow);
    const data = iface.encodeFunctionData('deliver', [cid, hashBytes]);

    return {
      to: escrowAddress,
      data,
      value: '0',
      chainId,
      cid,
    };
  }

  /**
   * Approve work (buyer)
   */
  async approveWork(job_milestone_id: string, privateKey: string, cid: string): Promise<string> {
    try {
      const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
      if (!exsitingJobMilestone) {
        throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
      }

      const existingJob = await jobService.getJobById(exsitingJobMilestone.job_id);
      if (!existingJob) {
        throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
      }

      const escrowAddress = exsitingJobMilestone.escrow;
      if (!escrowAddress) {
        throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
      }

      const wallet = web3Provider.getWallet(privateKey);
      const contract = this.getEscrowContract(escrowAddress, wallet);

      logger.info(`Approving work for escrow ${escrowAddress}, CID: ${cid}`);

      const tx = await contract.approve(cid, { gasLimit: 500000 });
      await tx.wait();

      logger.info(`Work approved successfully: ${tx.hash}`);

      await jobMilestoneService.updateJobMilestone(job_milestone_id, {
        status: 'approved',
      });

      await chainTxsService.createChainTx(
        'approve_work',
        BLOCKCHAIN_CONFIG.chainId,
        job_milestone_id,
        wallet.address,
        escrowAddress,
        tx.hash,
        'success',
        existingJob.client_id
      );

      return tx.hash;
    } catch (error: any) {
      logger.error('Error approving work:', error);
      throw new AppError(`Failed to approve work: ${error.message}`, 500);
    }
  }

  async buildApproveWorkTx(
    job_milestone_id: string,
    userId: string,
    chainId: number,
    cid: string
  ): Promise<EscrowTxData> {
    const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
    if (!exsitingJobMilestone) {
      throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
    }
    const escrowAddress = exsitingJobMilestone.escrow;
    if (!escrowAddress) {
      throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
    }

    const existingJob = await jobService.getJobById(exsitingJobMilestone.job_id);
    if (!existingJob) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    // OPTIONAL: enforce who can approve
    if (existingJob.client_id !== userId) {
      throw new AppError('Unauthorized', 403);
    }

    const iface = new ethers.Interface(CONTRACT_ABIS.Escrow);
    const data = iface.encodeFunctionData('approve', [cid]);

    return {
      to: escrowAddress,
      data,
      value: '0',
      chainId,
    };
  }
  /**
   * Withdraw funds (vendor)
   */
  async withdrawFunds(job_milestone_id: string, privateKey: string): Promise<string> {
    try {
      const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
      if (!exsitingJobMilestone) {
        throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
      }

      const escrowAddress = exsitingJobMilestone.escrow;
      if (!escrowAddress) {
        throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
      }

      const wallet = web3Provider.getWallet(privateKey);
      const contract = this.getEscrowContract(escrowAddress, wallet);

      logger.info(`Withdrawing funds from escrow ${escrowAddress}`);

      const tx = await contract.withdraw({ gasLimit: 1000000 });
      await tx.wait();

      logger.info(`Funds withdrawn successfully: ${tx.hash}`);

      await jobMilestoneService.updateJobMilestone(job_milestone_id, {
        status: 'released',
      });

      await chainTxsService.createChainTx(
        'withdraw_funds',
        BLOCKCHAIN_CONFIG.chainId,
        job_milestone_id,
        wallet.address,
        escrowAddress,
        tx.hash,
        'success',
        exsitingJobMilestone.freelancer_id
      );

      return tx.hash;
    } catch (error: any) {
      logger.error('Error withdrawing funds:', error);
      throw new AppError(`Failed to withdraw funds: ${error.message}`, 500);
    }
  }

  async buildWithdrawFundsTx(
    job_milestone_id: string,
    userId: string,
    chainId: number
  ): Promise<EscrowTxData> {
    const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
    if (!exsitingJobMilestone) {
      throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
    }
    const escrowAddress = exsitingJobMilestone.escrow;
    if (!escrowAddress) {
      throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
    }

    if (exsitingJobMilestone.freelancer_id !== userId) {
      throw new AppError('Unauthorized', 403);
    }

    const iface = new ethers.Interface(CONTRACT_ABIS.Escrow);
    const data = iface.encodeFunctionData('withdraw', []);
    return {
      to: escrowAddress,
      data,
      value: '0',
      chainId,
    };
  }

  /**
   * Initiate dispute
   */
  async initiateDispute(job_milestone_id: string, privateKey: string): Promise<string> {
    try {
      const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
      if (!exsitingJobMilestone) {
        throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
      }

      const existingJob = await jobService.getJobById(exsitingJobMilestone.job_id);
      if (!existingJob) {
        throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
      }

      const escrowAddress = exsitingJobMilestone.escrow;
      if (!escrowAddress) {
        throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
      }

      const wallet = web3Provider.getWallet(privateKey);
      const contract = this.getEscrowContract(escrowAddress, wallet);

      // Get dispute fee amount
      const info = await this.getEscrowInfo(escrowAddress);
      let disputeFee = 0n;
      if (info.buyer === wallet.address) {
        disputeFee = 0n;
      } else {
        disputeFee = info.disputeFeeAmount;
      }

      logger.info(`Initiating dispute for escrow ${escrowAddress}`);

      const tx = await contract.initiateDispute({
        value: disputeFee,
        gasLimit: 500000,
      });
      await tx.wait();

      logger.info(`Dispute initiated successfully: ${tx.hash}`);

      await jobMilestoneService.updateJobMilestone(job_milestone_id, {
        status: wallet.address === info.buyer ? 'disputedByClient' : 'disputedByFreelancer',
      });

      await chainTxsService.createChainTx(
        'initiate_dispute',
        BLOCKCHAIN_CONFIG.chainId,
        job_milestone_id,
        wallet.address,
        escrowAddress,
        tx.hash,
        'success',
        wallet.address === info.buyer ? existingJob.client_id : exsitingJobMilestone.freelancer_id
      );

      return tx.hash;
    } catch (error: any) {
      logger.error('Error initiating dispute:', error);
      throw new AppError(`Failed to initiate dispute: ${error.message}`, 500);
    }
  }

  async buildDisputeTx(
    job_milestone_id: string,
    userId: string,
    chainId: number
  ): Promise<EscrowTxData> {
    const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
    if (!exsitingJobMilestone) {
      throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
    }
    const escrowAddress = exsitingJobMilestone.escrow;
    if (!escrowAddress) {
      throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
    }
    const existingUser = await userService.getUserById(userId);
    if (!existingUser) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    const info = await this.getEscrowInfo(escrowAddress);
    let disputeFee = 0n;
    if (info.buyer.toLowerCase() === existingUser.address?.toLowerCase()) {
      disputeFee = 0n;
    } else {
      disputeFee = info.disputeFeeAmount;
    }
    const iface = new ethers.Interface(CONTRACT_ABIS.Escrow);
    const data = iface.encodeFunctionData('initiateDispute', []);
    return {
      to: escrowAddress,
      data,
      value: disputeFee.toString(),
      chainId,
    };
  }

  /**
   * Pay dispute fee (counterparty)
   */
  async venderPayDisputeFee(job_milestone_id: string, privateKey: string): Promise<string> {
    try {
      const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
      if (!exsitingJobMilestone) {
        throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
      }

      const escrowAddress = exsitingJobMilestone.escrow;
      if (!escrowAddress) {
        throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
      }

      const wallet = web3Provider.getWallet(privateKey);
      const contract = this.getEscrowContract(escrowAddress, wallet);

      const info = await this.getEscrowInfo(escrowAddress);
      const disputeFee = info.disputeFeeAmount;

      logger.info(`Paying dispute fee for escrow ${escrowAddress}`);

      const tx = await contract.payDisputeFee({
        value: disputeFee,
        gasLimit: 500000,
      });
      await tx.wait();

      logger.info(`Dispute fee paid successfully: ${tx.hash}`);

      await jobMilestoneService.updateJobMilestone(job_milestone_id, {
        status: 'disputedWithCounterSide',
      });

      await chainTxsService.createChainTx(
        'pay_dispute_fee',
        BLOCKCHAIN_CONFIG.chainId,
        job_milestone_id,
        wallet.address,
        escrowAddress,
        tx.hash,
        'success',
        exsitingJobMilestone.freelancer_id
      );

      return tx.hash;
    } catch (error: any) {
      logger.error('Error paying dispute fee:', error);
      throw new AppError(`Failed to pay dispute fee: ${error.message}`, 500);
    }
  }

  async buildVenderPayDisputeFeeTx(
    job_milestone_id: string,
    userId: string,
    chainId: number
  ): Promise<EscrowTxData> {
    const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
    if (!exsitingJobMilestone) {
      throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
  }
    const escrowAddress = exsitingJobMilestone.escrow;
    if (!escrowAddress) {
      throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
    }
    const existingUser = await userService.getUserById(userId);
    if (!existingUser) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    const info = await this.getEscrowInfo(escrowAddress);
    const disputeFee = info.disputeFeeAmount;
    const iface = new ethers.Interface(CONTRACT_ABIS.Escrow);
    const data = iface.encodeFunctionData('payDisputeFee', []);
    return {
      to: escrowAddress,
      data,
      value: disputeFee.toString(),
      chainId,
    };
  }
  /**
   * Buyer join the
   */
  async buyerJoinDispute(job_milestone_id: string, privateKey: string): Promise<string> {
    try {
      const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
      if (!exsitingJobMilestone) {
        throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
      }

      const existingJob = await jobService.getJobById(exsitingJobMilestone.job_id);
      if (!existingJob) {
        throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
      }

      const escrowAddress = exsitingJobMilestone.escrow;
      if (!escrowAddress) {
        throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
      }

      const wallet = web3Provider.getWallet(privateKey);
      const contract = this.getEscrowContract(escrowAddress, wallet);

      logger.info(`Buyer join the dispute for escrow ${escrowAddress}`);

      const tx = await contract.payDisputeFee({
        value: 0,
        gasLimit: 500000,
      });
      await tx.wait();

      logger.info(`Dispute fee paid successfully: ${tx.hash}`);

      await jobMilestoneService.updateJobMilestone(job_milestone_id, {
        status: 'disputedWithCounterSide',
      });

      await chainTxsService.createChainTx(
        'buyer_join_dispute',
        BLOCKCHAIN_CONFIG.chainId,
        job_milestone_id,
        wallet.address,
        escrowAddress,
        tx.hash,
        'success',
        existingJob.client_id
      );

      return tx.hash;
    } catch (error: any) {
      logger.error('Error paying dispute fee:', error);
      throw new AppError(`Failed to pay dispute fee: ${error.message}`, 500);
    }
  }

  async buildBuyerJoinDisputeTx(
    job_milestone_id: string,
    userId: string,
    chainId: number
  ): Promise<EscrowTxData> {
    const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
    if (!exsitingJobMilestone) {
      throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
    }
    const escrowAddress = exsitingJobMilestone.escrow;
    if (!escrowAddress) {
      throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
    }
    const existingUser = await userService.getUserById(userId);
    if (!existingUser) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    const iface = new ethers.Interface(CONTRACT_ABIS.Escrow);
    const data = iface.encodeFunctionData('payDisputeFee', []);
    return {
      to: escrowAddress,
      data,
      value: '0',
      chainId,
    };
  }
  /**
   * Resolve dispute (arbiter)
   */
  async resolveDispute(privateKey: string, job_milestone_id: string, favorBuyer: boolean): Promise<string> {
    try {
      const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
      if (!exsitingJobMilestone) {
        throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
      }

      const escrowAddress = exsitingJobMilestone.escrow;
      if (!escrowAddress) {
        throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
      }

      const wallet = web3Provider.getWallet(privateKey);
      const contract = this.getEscrowContract(escrowAddress, wallet);

      logger.info(`Resolving dispute for escrow ${escrowAddress}, favor buyer: ${favorBuyer}`);

      const tx = favorBuyer
        ? await contract.resolveToBuyer({ gasLimit: 1000000 })
        : await contract.resolveToVendor({ gasLimit: 1000000 });

      await tx.wait();

      logger.info(`Dispute resolved successfully: ${tx.hash}`);

      await jobMilestoneService.updateJobMilestone(job_milestone_id, {
        status: favorBuyer ? 'resolvedToBuyer' : 'resolvedToVendor',
      });
      return tx.hash;
    } catch (error: any) {
      logger.error('Error resolving dispute:', error);
      throw new AppError(`Failed to resolve dispute: ${error.message}`, 500);
    }
  }

  async buildResolveDisputeTx(
    job_milestone_id: string,
    favorBuyer: boolean,
    chainId: number
  ): Promise<EscrowTxData> {
    const exsitingJobMilestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
    if (!exsitingJobMilestone) {
      throw new AppError('Job milestone not found', 404, 'JOB_MILESTONE_NOT_FOUND');
  }
    const escrowAddress = exsitingJobMilestone.escrow;
    if (!escrowAddress) {
      throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
    }
    const iface = new ethers.Interface(CONTRACT_ABIS.Escrow);
    const data = favorBuyer ? iface.encodeFunctionData('resolveToBuyer', []) : iface.encodeFunctionData('resolveToVendor', []);
    return {
      to: escrowAddress,
      data,
      value: '0',
      chainId,
    };
  }

  /**
   * Estimate GRMPS reward per party (buyer + vendor) for a milestone escrow.
   */
  async getExpectedRewards(job_milestone_id: string) {
    const milestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
    if (!milestone?.escrow) {
      throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
    }
    const info = await this.getEscrowInfo(milestone.escrow);
    const zeroAddress = ethers.ZeroAddress;

    if (info.rewardToken === zeroAddress || info.rewardRatePer1e18 === 0n || info.amount === 0n) {
      return {
        configured: false,
        rewardToken: info.rewardToken,
        rewardPerSide: '0',
        totalReward: '0',
        buyer: info.buyer,
        vendor: info.vendor,
      };
    }

    const sideNative = (info.amount * info.rewardRateBps) / 10000n;
    const rewardPerSide = (sideNative * info.rewardRatePer1e18) / BigInt(1e18);

    return {
      configured: true,
      rewardToken: info.rewardToken,
      rewardPerSide: rewardPerSide.toString(),
      totalReward: (rewardPerSide * 2n).toString(),
      buyer: info.buyer,
      vendor: info.vendor,
    };
  }

  /**
   * Parse RewardPaid / RewardSkipped events from a withdraw transaction.
   */
  async parseRewardsFromTx(txHash: string, escrowAddress: string) {
    const provider = web3Provider.getProvider();
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new AppError('Transaction receipt not found', 404, 'TX_RECEIPT_NOT_FOUND');
    }

    const iface = new ethers.Interface(CONTRACT_ABIS.Escrow);
    const rewards: { recipient: string; amount: string; reason: string }[] = [];
    let skipped = false;
    let skipReason = '';

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (!parsed) continue;
        if (parsed.name === 'RewardPaid') {
          rewards.push({
            recipient: String(parsed.args[0]),
            amount: parsed.args[1].toString(),
            reason: String(parsed.args[2]),
          });
        }
        if (parsed.name === 'RewardSkipped') {
          skipped = true;
          skipReason = String(parsed.args[1] ?? '');
        }
      } catch {
        // ignore unrelated log signatures
      }
    }

    return {
      rewards,
      skipped,
      skipReason,
      distributed: rewards.length >= 2 && !skipped,
    };
  }

  /**
   * After on-chain withdraw, confirm GRMPS distribution and notify both parties.
   */
  async confirmWithdrawRewards(job_milestone_id: string, txHash: string) {
    const milestone = await jobMilestoneService.getJobMilestoneById(job_milestone_id);
    if (!milestone?.escrow) {
      throw new AppError('Escrow not found', 404, 'ESCROW_NOT_FOUND');
    }

    const job = await jobService.getJobById(milestone.job_id);
    const result = await this.parseRewardsFromTx(txHash, milestone.escrow);
    const formatGrmps = (wei: string) => (Number(wei) / 1e18).toFixed(4);

    const buyerReward = result.rewards.find((r) => r.reason === 'buyer_reward');
    const vendorReward = result.rewards.find((r) => r.reason === 'vendor_reward');

    if (buyerReward) {
      await notificationService.createNotification({
        user_id: job.client_id,
        type: notification_type.MILESTONE_FUNDS_RELEASED,
        entity_type: notification_entity.milestone,
        entity_id: job_milestone_id,
        title: 'GRMPS reward received',
        body: `You received ${formatGrmps(buyerReward.amount)} GRMPS for completing this milestone.`,
        payload: { reward_amount: buyerReward.amount, tx_hash: txHash, role: 'client' },
        read_at: null,
        created_at: new Date(),
      });
    }

    if (vendorReward) {
      await notificationService.createNotification({
        user_id: milestone.freelancer_id,
        type: notification_type.MILESTONE_FUNDS_RELEASED,
        entity_type: notification_entity.milestone,
        entity_id: job_milestone_id,
        title: 'GRMPS reward received',
        body: `You received ${formatGrmps(vendorReward.amount)} GRMPS for completing this milestone.`,
        payload: { reward_amount: vendorReward.amount, tx_hash: txHash, role: 'freelancer' },
        read_at: null,
        created_at: new Date(),
      });
    }

    return {
      ...result,
      buyerReward: buyerReward?.amount ?? null,
      vendorReward: vendorReward?.amount ?? null,
    };
  }

  /**
   * Verify GRMPS reward infrastructure (token, distributor auth, allowance).
   */
  async verifyRewardInfrastructure() {
    const provider = web3Provider.getProvider();
    const issues: string[] = [];
    const checks: Record<string, string | boolean | number> = {};

    if (!CONTRACT_ADDRESSES.grmpsToken) {
      issues.push('GRMPS_TOKEN_ADDRESS is not configured');
    }
    if (!CONTRACT_ADDRESSES.rewardDistributor) {
      issues.push('REWARD_DISTRIBUTOR_ADDRESS is not configured');
    }
    if (!CONTRACT_ADDRESSES.factory) {
      issues.push('FACTORY_ADDRESS is not configured');
    }

    if (issues.length > 0) {
      return { ok: false, issues, checks };
    }

    const distributor = new ethers.Contract(
      CONTRACT_ADDRESSES.rewardDistributor,
      CONTRACT_ABIS.RewardDistributor,
      provider
    );
    const grmps = new ethers.Contract(CONTRACT_ADDRESSES.grmpsToken, CONTRACT_ABIS.ERC20, provider);

    const rewardSource = await distributor.rewardSource();
    const factoryAuthorized = await distributor.authorizedFactories(CONTRACT_ADDRESSES.factory);
    const allowance = await grmps.allowance(rewardSource, CONTRACT_ADDRESSES.rewardDistributor);
    const balance = await grmps.balanceOf(rewardSource);

    checks.rewardSource = rewardSource;
    checks.factoryAuthorized = Boolean(factoryAuthorized);
    checks.allowance = allowance.toString();
    checks.balance = balance.toString();

    if (!factoryAuthorized) {
      issues.push('Factory is not authorized on RewardDistributor');
    }
    if (allowance === 0n) {
      issues.push('Reward source has zero GRMPS allowance for RewardDistributor');
    }
    if (balance === 0n) {
      issues.push('Reward source wallet has zero GRMPS balance');
    }

    return { ok: issues.length === 0, issues, checks };
  }
}

export const escrowService = new EscrowService();
