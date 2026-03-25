/**
 * TemplateEditorPage.jsx
 *
 * Full-screen HTML editor for creating and editing certificate templates.
 * Used by municipality admins only.
 *
 * Routes:
 *   /admin/municipality/certificate-templates/new   → create new template
 *   /admin/municipality/certificate-templates/:id   → edit existing template
 *
 * Features:
 *   - Form fields: name, certificate type, description
 *   - Large textarea HTML editor (monospace)
 *   - Placeholder reference panel (click to insert token at cursor)
 *   - HTML preview in modal (shows raw HTML, placeholders unresolved)
 *   - Save (POST) or update (PUT)
 */

import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import useAuth from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Certificate type options ──────────────────────────────────────────────────
const CERTIFICATE_TYPES = [
  { value: "barangay_clearance",    label: "Barangay Clearance" },
  { value: "indigency",             label: "Certificate of Indigency" },
  { value: "residency",             label: "Certificate of Residency" },
  { value: "good_moral",            label: "Good Moral Character" },
  { value: "solo_parent",           label: "Solo Parent" },
  { value: "low_income",            label: "Low Income" },
  { value: "burial_assistance",     label: "Burial Assistance" },
  { value: "cohabitation",          label: "Cohabitation" },
  { value: "first_time_job_seeker", label: "First Time Job Seeker" },
];

// ── Placeholder reference groups ──────────────────────────────────────────────
const PLACEHOLDER_GROUPS = [
  {
    group: "Resident",
    tokens: [
      { token: "resident.firstName",    desc: "First name" },
      { token: "resident.middleName",   desc: "Middle name" },
      { token: "resident.lastName",     desc: "Last name" },
      { token: "resident.fullName",     desc: "Full name (auto-joined)" },
      { token: "resident.birthdate",    desc: "Date of birth (long)" },
      { token: "resident.age",          desc: "Age (computed)" },
      { token: "resident.sex",          desc: "Sex" },
      { token: "resident.civilStatus",  desc: "Civil status" },
      { token: "resident.address",      desc: "Street + barangay" },
      { token: "resident.residentId",   desc: "Resident ID (RES-YYYY-NNNNNNN)" },
      { token: "resident.nationality",  desc: "Nationality" },
      { token: "resident.occupation",   desc: "Occupation" },
    ],
  },
  {
    group: "Barangay",
    tokens: [
      { token: "barangay.name", desc: "Barangay name" },
      { token: "barangay.code", desc: "Barangay PSGC code" },
    ],
  },
  {
    group: "Municipality",
    tokens: [
      { token: "municipality.name",     desc: "Municipality / city name" },
      { token: "municipality.province", desc: "Province" },
      { token: "municipality.region",   desc: "Region" },
    ],
  },
  {
    group: "Officials",
    tokens: [
      { token: "officials.captain",   desc: "Punong barangay" },
      { token: "officials.kagawad1",  desc: "Kagawad 1" },
      { token: "officials.kagawad2",  desc: "Kagawad 2" },
      { token: "officials.kagawad3",  desc: "Kagawad 3" },
      { token: "officials.kagawad4",  desc: "Kagawad 4" },
      { token: "officials.kagawad5",  desc: "Kagawad 5" },
      { token: "officials.kagawad6",  desc: "Kagawad 6" },
      { token: "officials.kagawad7",  desc: "Kagawad 7" },
      { token: "officials.secretary", desc: "Barangay secretary" },
      { token: "officials.treasurer", desc: "Barangay treasurer" },
    ],
  },
  {
    group: "Request / Transaction",
    tokens: [
      { token: "request.purpose",         desc: "Purpose stated by applicant" },
      { token: "request.date",            desc: "Date of issuance" },
      { token: "request.referenceNumber", desc: "Reference / tracking number" },
      { token: "request.orNumber",        desc: "Official receipt number" },
    ],
  },
];

// ── Default template for new certificates ────────────────────────────────────
const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 12pt;
      margin: 40px 60px;
      color: #000;
    }
    .header { text-align: center; margin-bottom: 24px; }
    .header p { margin: 2px 0; }
    .doc-title {
      font-size: 15pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 8px 0 4px;
    }
    .body-text {
      text-indent: 2em;
      line-height: 1.9;
      margin: 16px 0;
      text-align: justify;
    }
    .signature-block { margin-top: 64px; }
    .sig-line {
      display: inline-block;
      min-width: 220px;
      border-top: 1px solid #000;
      text-align: center;
      padding-top: 4px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .sig-title { font-size: 10pt; color: #444; }
    .footer {
      margin-top: 40px;
      font-size: 9pt;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>

  <div class="header">
    <p>Republic of the Philippines</p>
    <p>Province of {{ municipality.province }}</p>
    <p><strong>{{ municipality.name }}</strong></p>
    <p>Barangay {{ barangay.name }}</p>
    <p class="doc-title">Barangay Clearance</p>
    <p style="font-size:10pt; color:#555;">No. ___________</p>
  </div>

  <p><strong>TO WHOM IT MAY CONCERN:</strong></p>

  <p class="body-text">
    This is to certify that <strong>{{ resident.fullName }}</strong>,
    {{ resident.age }} years old, {{ resident.civilStatus }},
    a resident of {{ resident.address }}, {{ municipality.name }},
    Province of {{ municipality.province }}, is personally known to this
    office and is a person of good moral character and has no pending
    criminal record in this barangay.
  </p>

  <p class="body-text">
    This certification is issued upon the request of the above-named person
    for <strong>{{ request.purpose }}</strong> and for whatever legal purpose
    it may serve.
  </p>

  <p class="body-text">
    Issued this <strong>{{ request.date }}</strong> at Barangay
    {{ barangay.name }}, {{ municipality.name }}.
  </p>

  <div class="signature-block">
    <p class="sig-line">{{ officials.captain }}</p>
    <p class="sig-title">Punong Barangay</p>
  </div>

  <div class="footer">
    <p>Reference No.: {{ request.referenceNumber }}</p>
  </div>

</body>
</html>`;

// ── Main component ────────────────────────────────────────────────────────────
export default function TemplateEditorPage() {
  const navigate      = useNavigate();
  const { id }        = useParams();
  const isNew         = !id || id === "new";
  const { user }      = useAuth();
  const { toast }     = useToast();
  const queryClient   = useQueryClient();
  const textareaRef   = useRef(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const municipalityId = user?.target_id;

  const [form, setForm] = useState({
    name:            "",
    certificateType: "barangay_clearance",
    description:     "",
    htmlContent:     DEFAULT_HTML,
  });

  // ── Load template for editing ────────────────────────────────────────────
  // onSuccess/onError removed from useQuery in react-query v5 — use useEffect instead.
  const { data: templateData, isLoading: isLoadingTemplate, isError: isTemplateError } = useQuery({
    queryKey: ["certificate-template", id],
    queryFn: () =>
      apiClient
        .get(`/certificates/templates/${id}`)
        .then((r) => r.data.data),
    enabled: !isNew,
    retry: false,
  });

  useEffect(() => {
    if (templateData) {
      setForm({
        name:            templateData.name,
        certificateType: templateData.certificate_type,
        description:     templateData.description || "",
        htmlContent:     templateData.html_content,
      });
    }
  }, [templateData]);

  useEffect(() => {
    if (isTemplateError) {
      toast({ variant: "destructive", title: "Template not found" });
      navigate("/admin/municipality/certificate-templates");
    }
  }, [isTemplateError]);

  // ── Save mutation ────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => {
      if (isNew) {
        return apiClient
          .post("/certificates/templates", {
            municipalityId,
            certificateType: form.certificateType,
            name:            form.name,
            description:     form.description || undefined,
            htmlContent:     form.htmlContent,
          })
          .then((r) => r.data.data);
      } else {
        return apiClient
          .put(`/certificates/templates/${id}`, {
            name:        form.name,
            description: form.description || undefined,
            htmlContent: form.htmlContent,
          })
          .then((r) => r.data.data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["certificate-templates"]);
      toast({
        title: isNew ? "Template created" : "Template saved",
        description: isNew
          ? "The template is now available for certificate generation."
          : "Changes saved successfully.",
      });
      navigate("/admin/municipality/certificate-templates");
    },
    onError: (err) =>
      toast({
        variant: "destructive",
        title: "Save failed",
        description: err.response?.data?.message || err.message,
      }),
  });

  // ── Insert placeholder token at cursor ───────────────────────────────────
  const insertToken = (token) => {
    const el = textareaRef.current;
    if (!el) return;
    const start    = el.selectionStart;
    const end      = el.selectionEnd;
    const current  = form.htmlContent;
    const inserted = `{{ ${token} }}`;
    const next     = current.slice(0, start) + inserted + current.slice(end);
    setForm((f) => ({ ...f, htmlContent: next }));
    requestAnimationFrame(() => {
      el.selectionStart = start + inserted.length;
      el.selectionEnd   = start + inserted.length;
      el.focus();
    });
  };

  // ── Loading state (edit mode) ─────────────────────────────────────────────
  if (!isNew && isLoadingTemplate) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Loading template…
      </div>
    );
  }

  const canSave = form.name.trim() !== "" && form.htmlContent.trim() !== "";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1400px]">

      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <button
            onClick={() => navigate("/admin/municipality/certificate-templates")}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-1"
          >
            ← Certificate Templates
          </button>
          <h1 className="text-xl font-bold text-gray-800">
            {isNew ? "New Certificate Template" : "Edit Template"}
          </h1>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setPreviewOpen(true)}
            disabled={!form.htmlContent.trim()}
          >
            Preview HTML
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isLoading || !canSave}
          >
            {saveMutation.isLoading
              ? "Saving…"
              : isNew
              ? "Create Template"
              : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Two-column layout: editor (left) + reference panel (right) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* ── Left: metadata + HTML editor ─────────────────────────────── */}
        <div className="xl:col-span-2 space-y-4">

          {/* Metadata fields */}
          <div className="bg-white border rounded-xl p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Template Name *</Label>
                <Input
                  id="tpl-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Barangay Clearance 2025"
                />
              </div>

              {isNew && (
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-type">Certificate Type *</Label>
                  <select
                    id="tpl-type"
                    value={form.certificateType}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, certificateType: e.target.value }))
                    }
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {CERTIFICATE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400">
                    Only one active template per type is allowed per municipality.
                  </p>
                </div>
              )}

              {!isNew && (
                <div className="space-y-1.5">
                  <Label>Certificate Type</Label>
                  <p className="text-sm text-gray-600 h-10 flex items-center border rounded-md px-3 bg-gray-50">
                    {CERTIFICATE_TYPES.find((t) => t.value === form.certificateType)?.label ||
                      form.certificateType}
                  </p>
                  <p className="text-xs text-gray-400">
                    Certificate type cannot be changed after creation.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description (optional)</Label>
              <Input
                id="tpl-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Brief notes about this template version"
              />
            </div>
          </div>

          {/* HTML editor */}
          <div className="bg-white border rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="tpl-html">HTML Content *</Label>
              <span className="text-xs text-gray-400">
                {form.htmlContent.length.toLocaleString()} chars
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Write your certificate as HTML.
              Use{" "}
              <code className="bg-gray-100 px-1 rounded font-mono">
                {"{{ token }}"}
              </code>{" "}
              placeholders — click any token in the reference panel to insert it
              at the cursor position.
            </p>
            <Textarea
              id="tpl-html"
              ref={textareaRef}
              value={form.htmlContent}
              onChange={(e) =>
                setForm((f) => ({ ...f, htmlContent: e.target.value }))
              }
              className="font-mono text-xs min-h-[520px] resize-y leading-relaxed"
              spellCheck={false}
            />
          </div>
        </div>

        {/* ── Right: placeholder reference panel ───────────────────────── */}
        <div className="xl:col-span-1">
          <div className="bg-white border rounded-xl p-4 sticky top-4">
            <p className="font-semibold text-gray-700 text-sm mb-1">
              Placeholder Reference
            </p>
            <p className="text-xs text-gray-500 mb-3">
              Click a token to insert it at the cursor position in the HTML
              editor.
            </p>

            <div className="space-y-5 max-h-[680px] overflow-y-auto pr-1">
              {PLACEHOLDER_GROUPS.map((group) => (
                <div key={group.group}>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                    {group.group}
                  </p>
                  <div className="space-y-0.5">
                    {group.tokens.map((t) => (
                      <button
                        key={t.token}
                        type="button"
                        onClick={() => insertToken(t.token)}
                        className="w-full text-left flex items-start gap-2 p-1.5 rounded hover:bg-blue-50 transition-colors group"
                        title={`Insert {{ ${t.token} }}`}
                      >
                        <code className="text-xs bg-gray-100 group-hover:bg-blue-100 px-1.5 py-0.5 rounded text-blue-700 font-mono shrink-0 leading-tight">
                          {`{{ ${t.token} }}`}
                        </code>
                        <span className="text-xs text-gray-500 leading-tight mt-0.5">
                          {t.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── HTML Preview modal ──────────────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl" style={{ height: "85vh", display: "flex", flexDirection: "column" }}>
          <DialogHeader>
            <DialogTitle>HTML Preview</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-500 shrink-0">
            Showing the raw HTML template.{" "}
            <code className="bg-gray-100 px-1 rounded font-mono">
              {"{{ placeholders }}"}
            </code>{" "}
            will be replaced with real data when a certificate is actually
            generated.
          </p>
          <iframe
            srcDoc={form.htmlContent}
            title="Certificate Template Preview"
            className="w-full rounded border flex-1 mt-2"
            sandbox="allow-same-origin"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
