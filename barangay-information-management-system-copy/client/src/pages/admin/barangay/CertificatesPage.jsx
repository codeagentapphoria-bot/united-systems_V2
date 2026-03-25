/**
 * CertificatesPage.jsx  (AC3)
 *
 * Barangay admin page — unified certificate request queue.
 *
 * Shows both sources in one list:
 *   • Walk-in   — submitted at the barangay counter (requests table, type='certificate')
 *   • Portal    — submitted online by residents     (transactions table, Barangay Certificate category)
 *
 * Per-row actions:
 *   Generate PDF  → POST /api/certificates/generate/request/:id   (walk-in)
 *                   POST /api/certificates/generate/transaction/:id (portal)
 *   Update status → PUT  /api/certificates/queue/walkin/:id/status
 *                   PUT  /api/certificates/queue/portal/:id/status
 *
 * Route: /admin/barangay/certificates
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import useAuth from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const BIMS_API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// ── Certificate type display labels ──────────────────────────────────────────
const CERT_TYPE_LABELS = {
  barangay_clearance:    'Barangay Clearance',
  indigency:             'Certificate of Indigency',
  residency:             'Certificate of Residency',
  good_moral:            'Good Moral Character',
  solo_parent:           'Solo Parent Certificate',
  low_income:            'Certificate of Low Income',
  burial_assistance:     'Burial Assistance Certificate',
  cohabitation:          'Cohabitation Certificate',
  first_time_job_seeker: 'First Time Job Seeker Certificate',
  // Fallback for old walk-in requests that only stored 'certificate'
  certificate:           'Certificate',
};

// ── Walk-in status options ────────────────────────────────────────────────────
const WALKIN_STATUSES = ['pending', 'approved', 'rejected', 'completed'];

// ── Portal status options ─────────────────────────────────────────────────────
const PORTAL_STATUSES = ['PENDING', 'PROCESSING', 'FOR_RELEASE', 'RELEASED', 'CANCELLED', 'REJECTED'];

// ── Status display config ─────────────────────────────────────────────────────
const STATUS_STYLE = {
  // Walk-in
  pending:   'bg-yellow-100 text-yellow-800',
  approved:  'bg-blue-100   text-blue-800',
  rejected:  'bg-red-100    text-red-800',
  completed: 'bg-green-100  text-green-800',
  // Portal
  PENDING:     'bg-yellow-100 text-yellow-800',
  PROCESSING:  'bg-blue-100   text-blue-800',
  FOR_RELEASE: 'bg-purple-100 text-purple-800',
  RELEASED:    'bg-green-100  text-green-800',
  CANCELLED:   'bg-gray-100   text-gray-600',
  REJECTED:    'bg-red-100    text-red-800',
};

const statusLabel = (s) =>
  (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ── Source badge ──────────────────────────────────────────────────────────────
const SourceBadge = ({ source }) =>
  source === 'portal' ? (
    <Badge className="bg-indigo-100 text-indigo-700 text-xs">Portal</Badge>
  ) : (
    <Badge className="bg-orange-100 text-orange-700 text-xs">Walk-in</Badge>
  );

// ── Detail drawer component ───────────────────────────────────────────────────
const RequestDetail = ({ item, onClose, onStatusUpdated }) => {
  const { toast }       = useToast();
  const queryClient     = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const isWalkin = item.source === 'walkin';
  const statuses = isWalkin ? WALKIN_STATUSES : PORTAL_STATUSES;

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: (newStatus) => {
      const url = isWalkin
        ? `/certificates/queue/walkin/${item.source_id}/status`
        : `/certificates/queue/portal/${item.source_id}/status`;
      return apiClient.put(url, { status: newStatus }).then((r) => r.data);
    },
    onSuccess: (_, newStatus) => {
      toast({ title: 'Status updated' });
      onStatusUpdated(newStatus);
      queryClient.invalidateQueries(['certificate-queue']);
    },
    onError: (err) =>
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: err.response?.data?.message || err.message,
      }),
  });

  // PDF generation — uses direct fetch to handle binary response
  const handleGenerate = async () => {
    if (!item.certificate_type || item.certificate_type === 'certificate') {
      toast({
        variant: 'destructive',
        title: 'Cannot generate PDF',
        description:
          'Certificate type is not specified for this walk-in request. Update it first.',
      });
      return;
    }

    setGenerating(true);
    try {
      const url = isWalkin
        ? `${BIMS_API}/certificates/generate/request/${item.source_id}`
        : `${BIMS_API}/certificates/generate/transaction/${item.source_id}`;

      const resp = await fetch(url, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ certificateType: item.certificate_type }),
      });

      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error(json.message || 'PDF generation failed');
      }

      const blob     = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a         = document.createElement('a');
      a.href          = objectUrl;
      a.download      = `${item.certificate_type}_${item.source_id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);

      toast({ title: 'Certificate downloaded' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Generation failed',
        description: err.message,
      });
    } finally {
      setGenerating(false);
    }
  };

  const certLabel =
    CERT_TYPE_LABELS[item.certificate_type] || item.service_name || item.certificate_type;

  return (
    <div className="space-y-5">
      {/* Identity */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold text-gray-800">{item.applicant_name}</p>
          <p className="text-sm text-gray-500 mt-0.5">{certLabel}</p>
        </div>
        <SourceBadge source={item.source} />
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-400">Purpose</p>
          <p className="font-medium text-gray-700">{item.purpose || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Date Submitted</p>
          <p className="font-medium text-gray-700">
            {new Date(item.created_at).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Current Status</p>
          <Badge className={`text-xs mt-0.5 ${STATUS_STYLE[item.status_col] ?? 'bg-gray-100 text-gray-600'}`}>
            {statusLabel(item.status_col)}
          </Badge>
        </div>
        {item.payment_status && (
          <div>
            <p className="text-xs text-gray-400">Payment</p>
            <p className="font-medium text-gray-700">{statusLabel(item.payment_status)}</p>
          </div>
        )}
      </div>

      {/* Update status */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Update Status
        </p>
        <div className="flex flex-wrap gap-2">
          {statuses
            .filter((s) => s.toLowerCase() !== (item.status_col ?? '').toLowerCase())
            .map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate(s)}
              >
                → {statusLabel(s)}
              </Button>
            ))}
        </div>
      </div>

      {/* Generate PDF */}
      <div className="pt-2 border-t">
        <Button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full"
        >
          {generating ? 'Generating PDF…' : 'Generate & Download Certificate PDF'}
        </Button>
        {(!item.certificate_type || item.certificate_type === 'certificate') && (
          <p className="text-xs text-orange-600 mt-1.5">
            Certificate type not specified — PDF generation unavailable until type is set.
          </p>
        )}
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CertificatesPage() {
  const { user }    = useAuth();
  const { toast }   = useToast();

  const [page,         setPage]         = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selected,     setSelected]     = useState(null);  // currently open detail
  const [localStatus,  setLocalStatus]  = useState({});    // optimistic status updates

  const barangayId = user?.target_id;

  // ── Fetch queue ─────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery({
    queryKey: ['certificate-queue', barangayId, statusFilter, sourceFilter, page],
    queryFn: () =>
      apiClient
        .get('/certificates/queue', {
          params: {
            barangayId,
            status:  statusFilter,
            source:  sourceFilter,
            page,
            perPage: 15,
          },
        })
        .then((r) => r.data),
    enabled: !!barangayId,
    keepPreviousData: true,
  });

  const items      = data?.data         ?? [];
  const pagination = data?.pagination   ?? { total: 0, totalPages: 1 };

  // Merge optimistic status overrides
  const displayItems = items.map((item) =>
    localStatus[item.source_id]
      ? { ...item, status_col: localStatus[item.source_id] }
      : item
  );

  return (
    <div className="space-y-5 max-w-6xl">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-800">Certificate Requests</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Unified queue — walk-in counter requests and portal submissions for this barangay.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(1); }}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="walkin">Walk-in Only</SelectItem>
            <SelectItem value="portal">Portal Only</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {/* Walk-in statuses */}
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            {/* Portal statuses */}
            <SelectItem value="PROCESSING">Processing</SelectItem>
            <SelectItem value="FOR_RELEASE">For Release</SelectItem>
            <SelectItem value="RELEASED">Released</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-gray-400 self-center ml-auto">
          {pagination.total} request{pagination.total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Queue list */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
          ) : isError ? (
            <div className="py-16 text-center text-red-500 text-sm">
              Failed to load queue. Check that the BIMS server is running.
            </div>
          ) : displayItems.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-gray-500 font-medium">No certificate requests found</p>
              <p className="text-sm text-gray-400 mt-1">
                {statusFilter !== 'all' || sourceFilter !== 'all'
                  ? 'Try clearing the filters.'
                  : 'Walk-in requests and portal submissions will appear here.'}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {displayItems.map((item) => (
                <button
                  key={`${item.source}-${item.source_id}`}
                  className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors"
                  onClick={() => { setSelected(item); setLocalStatus({}); }}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800 text-sm">
                          {item.applicant_name}
                        </span>
                        <SourceBadge source={item.source} />
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {CERT_TYPE_LABELS[item.certificate_type] ||
                          item.service_name ||
                          item.certificate_type}
                        {item.purpose ? ` — ${item.purpose}` : ''}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(item.created_at).toLocaleDateString('en-PH', {
                          dateStyle: 'medium',
                        })}
                      </p>
                    </div>

                    <Badge
                      className={`text-xs shrink-0 ${STATUS_STYLE[item.status_col] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {statusLabel(item.status_col)}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Page {page} of {pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Request detail modal */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Certificate Request</DialogTitle>
          </DialogHeader>
          {selected && (
            <RequestDetail
              item={
                localStatus[selected.source_id]
                  ? { ...selected, status_col: localStatus[selected.source_id] }
                  : selected
              }
              onClose={() => setSelected(null)}
              onStatusUpdated={(newStatus) =>
                setLocalStatus((prev) => ({ ...prev, [selected.source_id]: newStatus }))
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
