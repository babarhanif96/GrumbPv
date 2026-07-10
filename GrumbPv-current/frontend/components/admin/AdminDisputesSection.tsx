'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  getAdminDisputes,
  getAdminJobDetails,
  getAdminSystemSettings,
  resolveDispute,
} from '@/utils/adminFunctions';
import { AdminDisputeMilestone, AdminJobDetails, Pagination } from '@/types/admin';
import { CONFIG } from '@/config/config';
import SmallLoading from '@/components/smallLoading';
import AdminJobModal from '@/components/admin/modals/AdminJobModal';
import Button from '@/components/button';
import { toast } from 'react-toastify';
import { useWallet } from '@/context/walletContext';
import { updateJobMilestone } from '@/utils/functions';

const STATUS_FILTERS = [
  { value: 'all', label: 'All disputes' },
  { value: 'disputedWithCounterSide', label: 'Ready to resolve' },
  { value: 'disputedByClient', label: 'Awaiting freelancer' },
  { value: 'disputedByFreelancer', label: 'Awaiting client' },
];

const formatStatus = (status: string) =>
  status.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();

const AdminDisputesSection = () => {
  const searchParams = useSearchParams();
  const highlightJobId = searchParams.get('jobId') ?? '';
  const [disputes, setDisputes] = useState<AdminDisputeMilestone[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [summary, setSummary] = useState({ total: 0, readyToResolve: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedJob, setSelectedJob] = useState<AdminJobDetails | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [arbiterAddress, setArbiterAddress] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const { sendTransaction, address } = useWallet();

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    const [disputesRes, settingsRes] = await Promise.all([
      getAdminDisputes({
        page,
        limit: 20,
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
      getAdminSystemSettings(),
    ]);
    if (disputesRes.success) {
      setDisputes(disputesRes.data || []);
      setPagination(disputesRes.pagination || null);
      setSummary(disputesRes.summary || { total: 0, readyToResolve: 0 });
    }
    if (settingsRes.success && settingsRes.data) {
      setArbiterAddress(settingsRes.data.arbiter_address);
    }
    setLoading(false);
  }, [page, statusFilter]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  useEffect(() => {
    if (highlightJobId && !loading && disputes.length > 0) {
      const match = disputes.find((d) => d.job_id === highlightJobId);
      if (match) {
        void openJobModal(match.job_id);
      }
    }
  }, [highlightJobId, loading, disputes]);

  const openJobModal = async (jobId: string) => {
    setLoadingDetails(true);
    setModalOpen(true);
    const result = await getAdminJobDetails(jobId);
    if (result.success && result.data) {
      setSelectedJob(result.data);
    }
    setLoadingDetails(false);
  };

  const handleResolve = async (milestoneId: string, favorBuyer: boolean) => {
    if (address?.toLowerCase() !== arbiterAddress?.toLowerCase()) {
      toast.error('Connect the arbiter wallet to resolve disputes.');
      return;
    }
    setResolvingId(milestoneId);
    const result = await resolveDispute(milestoneId, favorBuyer, Number(CONFIG.chainId));
    if (!result.success || !result.data) {
      toast.error(result.error || 'Failed to build resolve transaction');
      setResolvingId(null);
      return;
    }
    const { hash, error } = await sendTransaction({
      to: result.data.to,
      data: result.data.data,
      value: result.data.value,
      chainId: Number(result.data.chainId),
    });
    if (!hash) {
      toast.error(error || 'Transaction failed');
      setResolvingId(null);
      return;
    }
    await updateJobMilestone(milestoneId, {
      status: favorBuyer ? 'resolvedToBuyer' : 'resolvedToVendor',
    });
    toast.success(`Dispute resolved in favor of ${favorBuyer ? 'client' : 'freelancer'}`);
    setResolvingId(null);
    fetchDisputes();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <SmallLoading />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
          <p className="text-small text-gray-500">Open disputes</p>
          <p className="text-display font-bold text-red-600">{summary.total}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
          <p className="text-small text-gray-500">Ready to resolve</p>
          <p className="text-display font-bold text-amber-600">{summary.readyToResolve}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
          <p className="text-small text-gray-500">Arbiter wallet</p>
          <p className="text-tiny font-mono text-gray-700 break-all">{arbiterAddress || 'Not configured'}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setStatusFilter(f.value);
              setPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-small font-medium transition-colors ${
              statusFilter === f.value
                ? 'bg-[#7E3FF2] text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {disputes.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center border border-gray-100">
          <p className="text-gray-500">No disputes in this queue.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map((dispute) => (
            <div
              key={dispute.id}
              className={`bg-white rounded-xl p-5 border shadow-sm ${
                dispute.readyToResolve ? 'border-amber-300 bg-amber-50/30' : 'border-gray-100'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-normal font-bold text-black">{dispute.job.title}</h3>
                    {dispute.readyToResolve && (
                      <span className="text-tiny px-2 py-0.5 rounded-full bg-amber-400 text-amber-900 font-semibold">
                        Action required
                      </span>
                    )}
                  </div>
                  <p className="text-small text-gray-600">
                    Milestone: <span className="font-medium">{dispute.title}</span>
                  </p>
                  <p className="text-small text-gray-600">
                    Amount: <span className="font-medium">{dispute.amount} {dispute.job.token_symbol || 'BNB'}</span>
                  </p>
                  <p className="text-small">
                    Status: <span className="text-red-600 font-medium">{formatStatus(dispute.status)}</span>
                  </p>
                  <div className="grid sm:grid-cols-2 gap-2 text-tiny text-gray-500">
                    <p>Client: {dispute.job.client.display_name || dispute.job.client.email || '—'}</p>
                    <p>Freelancer: {dispute.freelancer.display_name || dispute.freelancer.email || '—'}</p>
                  </div>
                  {dispute.escrow && (
                    <p className="text-tiny font-mono text-gray-400 break-all">Escrow: {dispute.escrow}</p>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                  <Button padding="px-4 py-2" onClick={() => openJobModal(dispute.job_id)}>
                    View details
                  </Button>
                  {dispute.readyToResolve && (
                    <>
                      <Button
                        padding="px-4 py-2"
                        onClick={() => handleResolve(dispute.id, true)}
                        disabled={resolvingId === dispute.id}
                      >
                        Resolve to client
                      </Button>
                      <Button
                        padding="px-4 py-2"
                        onClick={() => handleResolve(dispute.id, false)}
                        disabled={resolvingId === dispute.id}
                      >
                        Resolve to freelancer
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-4 py-2 rounded-lg border border-gray-200 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-small text-gray-600">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 rounded-lg border border-gray-200 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      <AdminJobModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedJob(null);
        }}
        job={selectedJob}
        loading={loadingDetails}
        arbiterAddress={arbiterAddress}
      />
    </div>
  );
};

export default AdminDisputesSection;
