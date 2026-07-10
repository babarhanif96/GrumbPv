/**
 * Verify GRMPS reward infrastructure before launch.
 *
 * Usage (from backend folder):
 *   node scripts/verify-grmps-rewards.mjs
 *
 * Requires .env with RPC, GRMPS_TOKEN_ADDRESS, REWARD_DISTRIBUTOR_ADDRESS, FACTORY_ADDRESS.
 */
import { config } from 'dotenv';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadAbi = (name) => JSON.parse(readFileSync(join(__dirname, '../abi', `${name}.json`), 'utf8')).abi;

const rpcUrl =
  process.env.BSC_RPC_URL ||
  (parseInt(process.env.CHAIN_ID || '56', 10) === 56
    ? process.env.BSC_MAINNET_RPC_URL
    : process.env.BSC_TESTNET_RPC_URL);

const provider = new ethers.JsonRpcProvider(rpcUrl);
const grmpsAddress = process.env.GRMPS_TOKEN_ADDRESS;
const distributorAddress = process.env.REWARD_DISTRIBUTOR_ADDRESS;
const factoryAddress = process.env.FACTORY_ADDRESS;

const erc20Abi = loadAbi('RewardDistributor').length ? [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
] : [];
const distributorAbi = loadAbi('RewardDistributor');

async function main() {
  console.log('=== GRMPS Reward Infrastructure Check ===\n');

  const issues = [];
  if (!grmpsAddress) issues.push('GRMPS_TOKEN_ADDRESS missing');
  if (!distributorAddress) issues.push('REWARD_DISTRIBUTOR_ADDRESS missing');
  if (!factoryAddress) issues.push('FACTORY_ADDRESS missing');
  if (issues.length) {
    issues.forEach((i) => console.error('✗', i));
    process.exit(1);
  }

  const distributor = new ethers.Contract(distributorAddress, distributorAbi, provider);
  const grmps = new ethers.Contract(grmpsAddress, [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
  ], provider);

  const rewardSource = await distributor.rewardSource();
  const rewardToken = await distributor.rewardToken();
  const factoryAuthorized = await distributor.authorizedFactories(factoryAddress);
  const allowance = await grmps.allowance(rewardSource, distributorAddress);
  const balance = await grmps.balanceOf(rewardSource);

  console.log('Reward token:', rewardToken);
  console.log('Reward source:', rewardSource);
  console.log('Factory authorized:', factoryAuthorized);
  console.log('GRMPS balance (reward source):', ethers.formatEther(balance));
  console.log('GRMPS allowance (source → distributor):', ethers.formatEther(allowance));

  if (rewardToken.toLowerCase() !== grmpsAddress.toLowerCase()) {
    issues.push('Distributor reward token does not match GRMPS_TOKEN_ADDRESS');
  }
  if (!factoryAuthorized) {
    issues.push('Factory is NOT authorized on RewardDistributor — run setAuthorizedFactory');
  }
  if (allowance === 0n) {
    issues.push('Zero allowance — reward source must approve RewardDistributor');
  }
  if (balance === 0n) {
    issues.push('Reward source has zero GRMPS balance');
  }

  console.log('');
  if (issues.length === 0) {
    console.log('✓ All checks passed. GRMPS rewards are ready for distribution.');
    process.exit(0);
  }

  issues.forEach((i) => console.error('✗', i));
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
