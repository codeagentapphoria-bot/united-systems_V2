/**
 * RegistrationApprovalsPage.jsx
 *
 * BIMS admin page to review and process resident registration requests
 * that come in from the portal.
 *
 * Actions: Approve, Reject, Mark Under Review, Request Resubmission
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import useAuth from "@/hooks/useAuth";

const STATUS_BADGE = {
  pending: "bg-yellow-100 text-yellow-800",
  under_review: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  requires_resubmission: "bg-orange-100 text-orange-800",
};

export default function RegistrationApprovalsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [filterStatus, setFilterStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [actionType, setActionType] = useState(null); // 'approve' | 'reject' | 'resubmit'
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["registrationRequests", filterStatus, search, page],
    queryFn: () =>
      apiClient
        .get("/portal-registration/requests", {
          params: {
            status: filterStatus || undefined,
            search: search || undefined,
            barangayId:
              user?.target_type === "barangay" ? user.target_id : undefined,
            page,
            limit: 20,
          },
        })
        .then((r) => r.data.data),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action, notes }) =>
      apiClient.post(`/portal-registration/requests/${id}/review`, {
        action,
        adminNotes: notes,
      }),
    onSuccess: (_, { action }) => {
      toast({
        title: action === "approve" ? "Registration Approved" : "Registration Rejected",
      });
      queryClient.invalidateQueries({ queryKey: ["registrationRequests"] });
      setSelectedRequest(null);
      setAdminNotes("");
      setActionType(null);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.response?.data?.message || error.message,
      });
    },
  });

  const underReviewMutation = useMutation({
    mutationFn: (id) =>
      apiClient.patch(`/portal-registration/requests/${id}/under-review`),
    onSuccess: () => {
      toast({ title: "Marked as Under Review" });
      queryClient.invalidateQueries({ queryKey: ["registrationRequests"] });
    },
  });

  const resubmitMutation = useMutation({
    mutationFn: ({ id, notes }) =>
      apiClient.post(`/portal-registration/requests/${id}/request-docs`, {
        adminNotes: notes,
      }),
    onSuccess: () => {
      toast({ title: "Resubmission requested" });
      queryClient.invalidateQueries({ queryKey: ["registrationRequests"] });
      setSelectedRequest(null);
      setAdminNotes("");
      setActionType(null);
    },
  });

  const handleAction = () => {
    if (!selectedRequest || !actionType) return;
    if (actionType === "approve" || actionType === "reject") {
      reviewMutation.mutate({
        id: selectedRequest.id,
        action: actionType,
        notes: adminNotes,
      });
    } else if (actionType === "resubmit") {
      resubmitMutation.mutate({ id: selectedRequest.id, notes: adminNotes });
    }
  };

  const requests = data?.requests || [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Registration Approvals</h1>
        <span className="text-sm text-gray-500">
          {pagination?.total || 0} total requests
        </span>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="under_review">Under Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="requires_resubmission">Requires Resubmission</option>
        </select>
        <input
          type="text"
          placeholder="Search by name or username..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-gray-400 text-center py-8">Loading...</p>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">📋</p>
          <p>No registration requests found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Applicant</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Username</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Barangay</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Submitted</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {requests.map((req) => {
                const r = req.resident;
                const fullName = r
                  ? `${r.last_name}, ${r.first_name}${r.middle_name ? " " + r.middle_name.charAt(0) + "." : ""}`
                  : "—";
                return (
                  <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium">{fullName}</td>
                    <td className="px-4 py-3 text-gray-500">@{r?.username}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {r?.barangay?.barangay_name || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {req.created_at
                        ? new Date(req.created_at).toLocaleDateString("en-PH")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          STATUS_BADGE[req.status] || "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {req.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {/* View details */}
                        <button
                          onClick={() => setSelectedRequest(req)}
                          className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                        >
                          View
                        </button>
                        {/* Mark under review (from pending) */}
                        {req.status === "pending" && (
                          <button
                            onClick={() => underReviewMutation.mutate(req.id)}
                            className="text-xs px-2 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50"
                          >
                            Review
                          </button>
                        )}
                        {/* Approve */}
                        {["pending", "under_review"].includes(req.status) && (
                          <button
                            onClick={() => {
                              setSelectedRequest(req);
                              setActionType("approve");
                            }}
                            className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            Approve
                          </button>
                        )}
                        {/* Reject */}
                        {["pending", "under_review"].includes(req.status) && (
                          <button
                            onClick={() => {
                              setSelectedRequest(req);
                              setActionType("reject");
                            }}
                            className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2 p-3 border-t">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded text-sm disabled:opacity-40"
              >
                Previous
              </button>
              <span className="px-3 py-1 text-sm text-gray-500">
                {page} / {pagination.totalPages}
              </span>
              <button
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Action Modal */}
      {selectedRequest && actionType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full space-y-4">
            <h2 className="text-lg font-bold text-gray-800">
              {actionType === "approve" && "Approve Registration"}
              {actionType === "reject" && "Reject Registration"}
              {actionType === "resubmit" && "Request Resubmission"}
            </h2>

            {selectedRequest.resident && (
              <p className="text-gray-600">
                Applicant:{" "}
                <strong>
                  {selectedRequest.resident.first_name} {selectedRequest.resident.last_name}
                </strong>
              </p>
            )}

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Admin Notes {actionType === "reject" || actionType === "resubmit" ? "*" : "(optional)"}
              </label>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder={
                  actionType === "approve"
                    ? "Optional notes..."
                    : actionType === "reject"
                    ? "Reason for rejection..."
                    : "What documents or information is needed?"
                }
                className="w-full border rounded-lg p-3 text-sm resize-none h-24"
              />
            </div>

            {actionType === "approve" && (
              <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800">
                A Resident ID will be generated. The resident can check their status at the portal registration status page.
              </div>
            )}

            <div className="flex gap-3">
              <button
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 text-gray-700"
                onClick={() => {
                  setSelectedRequest(null);
                  setAdminNotes("");
                  setActionType(null);
                }}
                disabled={reviewMutation.isPending || resubmitMutation.isPending}
              >
                Cancel
              </button>
              <button
                className={`flex-1 px-4 py-2 rounded-lg text-white disabled:opacity-50 ${
                  actionType === "approve"
                    ? "bg-green-600 hover:bg-green-700"
                    : actionType === "reject"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-orange-500 hover:bg-orange-600"
                }`}
                onClick={handleAction}
                disabled={
                  reviewMutation.isPending ||
                  resubmitMutation.isPending ||
                  ((actionType === "reject" || actionType === "resubmit") && !adminNotes.trim())
                }
              >
                {reviewMutation.isPending || resubmitMutation.isPending
                  ? "Processing..."
                  : actionType === "approve"
                  ? "Approve"
                  : actionType === "reject"
                  ? "Reject"
                  : "Request Resubmission"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail View Modal (view only) */}
      {selectedRequest && !actionType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full space-y-4 my-4">
            <div className="flex justify-between items-start">
              <h2 className="text-lg font-bold text-gray-800">Registration Details</h2>
              <button
                onClick={() => setSelectedRequest(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ✕
              </button>
            </div>

            {selectedRequest.resident && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400 uppercase">Full Name</p>
                  <p className="font-medium">
                    {selectedRequest.resident.first_name}{" "}
                    {selectedRequest.resident.middle_name}{" "}
                    {selectedRequest.resident.last_name}{" "}
                    {selectedRequest.resident.extension_name}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Username</p>
                  <p className="font-mono">@{selectedRequest.resident.username}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Birthdate</p>
                  <p>
                    {selectedRequest.resident.birthdate
                      ? new Date(selectedRequest.resident.birthdate).toLocaleDateString("en-PH")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Sex</p>
                  <p className="capitalize">{selectedRequest.resident.sex || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Contact</p>
                  <p>{selectedRequest.resident.contact_number || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Email</p>
                  <p className="truncate">{selectedRequest.resident.email || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Barangay</p>
                  <p>{selectedRequest.resident.barangay?.barangay_name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Status</p>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      STATUS_BADGE[selectedRequest.status] || ""
                    }`}
                  >
                    {selectedRequest.status}
                  </span>
                </div>
              </div>
            )}

            {/* Selfie / ID doc */}
            {selectedRequest.selfie_url && (
              <div>
                <p className="text-xs text-gray-400 uppercase mb-1">Selfie with ID</p>
                <img
                  src={selectedRequest.selfie_url}
                  alt="Selfie"
                  className="w-32 h-32 object-cover rounded border"
                />
              </div>
            )}

            {selectedRequest.admin_notes && (
              <div className="bg-gray-50 border rounded p-3 text-sm">
                <p className="text-xs text-gray-400 uppercase mb-1">Admin Notes</p>
                <p>{selectedRequest.admin_notes}</p>
              </div>
            )}

            {/* Action buttons (if still actionable) */}
            {["pending", "under_review"].includes(selectedRequest.status) && (
              <div className="flex gap-2 pt-2 border-t">
                <button
                  onClick={() => setActionType("approve")}
                  className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
                >
                  Approve
                </button>
                <button
                  onClick={() => setActionType("resubmit")}
                  className="flex-1 px-3 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600"
                >
                  Request Docs
                </button>
                <button
                  onClick={() => setActionType("reject")}
                  className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
