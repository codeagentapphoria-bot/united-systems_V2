/**
 * PortalMyHousehold.tsx
 *
 * Resident portal page: self-register a household (2-step form) and manage
 * family members after registration.
 *
 * Step 1 — Household Information: all fields from the households table.
 * Step 2 — Family Members: add members by Resident ID before submitting.
 *
 * All API calls go through the shared `api` axios instance (E-Services backend,
 * VITE_API_BASE_URL) so the resident's auth cookie is always in scope.
 */

import React, { useState, useEffect } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import api from '@/services/api/auth.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RELATIONSHIPS = [
  'Spouse', 'Child', 'Parent', 'Sibling', 'Grandparent', 'Grandchild',
  'In-law', 'Aunt/Uncle', 'Niece/Nephew', 'Cousin', 'Other',
];

const HOUSING_TYPES   = ['Permanent', 'Semi-permanent', 'Makeshift', 'Informal Settler'];
const STRUCTURE_TYPES = ['Concrete', 'Hollow Blocks', 'Wood', 'Bamboo', 'Mixed'];
const WATER_SOURCES   = ['Faucet / NAWASA', 'Deep Well', 'Spring', 'Communal Water', 'Bought from vendor'];
const TOILET_TYPES    = ['Flush toilet (water-sealed)', 'Pit privy', 'Communal toilet', 'None'];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const householdInfoSchema = z.object({
  houseNumber:    z.string().optional(),
  street:         z.string().optional(),
  housingType:    z.string().optional(),
  structureType:  z.string().optional(),
  electricity:    z.string().optional(), // "Yes" | "No"
  waterSource:    z.string().optional(),
  toiletFacility: z.string().optional(),
});

const addMemberSchema = z.object({
  residentId:         z.string().min(1, 'Resident ID is required'),
  relationshipToHead: z.string().optional(),
  familyGroup:        z.string().optional(),
});

const postRegAddMemberSchema = z.object({
  memberResidentId:   z.string().min(1, 'Resident ID is required'),
  relationshipToHead: z.string().optional(),
  familyGroup:        z.string().optional(),
});

type HouseholdInfoData    = z.infer<typeof householdInfoSchema>;
type AddMemberFormData    = z.infer<typeof addMemberSchema>;
type PostRegAddMemberData = z.infer<typeof postRegAddMemberSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingMember {
  residentId:         string;
  relationshipToHead: string;
  familyGroup:        string;
}

// ---------------------------------------------------------------------------
// Helper: group pending members by family group name
// ---------------------------------------------------------------------------
function groupByFamily(members: PendingMember[]): Record<string, PendingMember[]> {
  return members.reduce<Record<string, PendingMember[]>>((acc, m) => {
    const key = m.familyGroup || 'Main Family';
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});
}

// ---------------------------------------------------------------------------
// Step indicator component
// ---------------------------------------------------------------------------
const StepIndicator: React.FC<{ current: number; total: number }> = ({ current, total }) => (
  <div className="flex items-center gap-2 mb-6">
    {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
      <React.Fragment key={n}>
        <div
          className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold border-2
            ${n === current
              ? 'bg-primary border-primary text-primary-foreground'
              : n < current
                ? 'bg-primary/20 border-primary/40 text-primary'
                : 'bg-muted border-muted-foreground/30 text-muted-foreground'
            }`}
        >
          {n}
        </div>
        {n < total && <div className="flex-1 h-px bg-muted-foreground/20" />}
      </React.Fragment>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export const PortalMyHousehold: React.FC = () => {
  const { user }  = useAuth();
  const { toast } = useToast();

  // Registration flow state
  const [step, setStep]                     = useState<1 | 2>(1);
  const [savedInfo, setSavedInfo]           = useState<HouseholdInfoData | null>(null);
  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);

  // Post-registration state
  const [household, setHousehold]           = useState<any>(null);
  const [isLoading, setIsLoading]           = useState(true);
  const [isSubmitting, setIsSubmitting]     = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [addMemberOpen, setAddMemberOpen]   = useState(false);

  const residentId = (user as any)?.id;
  const isActive   = (user as any)?.status === 'active';

  // Step 1 form
  const infoForm = useForm<HouseholdInfoData>({
    resolver: zodResolver(householdInfoSchema),
    defaultValues: {},
  });

  // Step 2 inline add-member form
  const addMemberForm = useForm<AddMemberFormData>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { residentId: '', relationshipToHead: '', familyGroup: 'Main Family' },
  });

  // Post-registration add-member dialog form
  const postRegForm = useForm<PostRegAddMemberData>({
    resolver: zodResolver(postRegAddMemberSchema),
    defaultValues: { memberResidentId: '', relationshipToHead: '', familyGroup: 'Main Family' },
  });

  useEffect(() => {
    if (!residentId || !isActive) { setIsLoading(false); return; }
    loadHousehold();
  }, [residentId]);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------
  const loadHousehold = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/portal/household/my');
      setHousehold(response.data.data);
    } catch {
      setHousehold(null);
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Step 1 → Step 2
  // -------------------------------------------------------------------------
  const handleStep1Submit = (data: HouseholdInfoData) => {
    setSavedInfo(data);
    setStep(2);
  };

  // -------------------------------------------------------------------------
  // Step 2: add a pending member to the local list
  // -------------------------------------------------------------------------
  const handleAddPendingMember = (data: AddMemberFormData) => {
    const group = (data.familyGroup || 'Main Family').trim();

    if (pendingMembers.some((m) => m.residentId === data.residentId)) {
      toast({ variant: 'destructive', title: 'Duplicate', description: 'That Resident ID is already in the list.' });
      return;
    }

    setPendingMembers((prev) => [
      ...prev,
      {
        residentId:         data.residentId.trim(),
        relationshipToHead: data.relationshipToHead || '',
        familyGroup:        group,
      },
    ]);
    addMemberForm.reset({ residentId: '', relationshipToHead: '', familyGroup: group });
  };

  const removePendingMember = (rid: string) => {
    setPendingMembers((prev) => prev.filter((m) => m.residentId !== rid));
  };

  // -------------------------------------------------------------------------
  // Final registration submit
  // -------------------------------------------------------------------------
  const handleRegisterHousehold = async () => {
    if (!savedInfo) return;
    setIsSubmitting(true);

    const grouped         = groupByFamily(pendingMembers);
    const familiesPayload = Object.entries(grouped).map(([groupName, members]) => ({
      groupName,
      members: members.map((m) => ({
        residentId:         m.residentId,
        relationshipToHead: m.relationshipToHead || null,
      })),
    }));

    try {
      await api.post('/portal/household', {
        houseNumber:    savedInfo.houseNumber    || null,
        street:         savedInfo.street         || null,
        housingType:    savedInfo.housingType    || null,
        structureType:  savedInfo.structureType  || null,
        electricity:    savedInfo.electricity === 'Yes',
        waterSource:    savedInfo.waterSource    || null,
        toiletFacility: savedInfo.toiletFacility || null,
        barangayId:     (user as any)?.barangay?.id ?? null,
        families:       familiesPayload,
      });
      toast({ title: 'Household registered successfully!' });
      loadHousehold();
    } catch (error: any) {
      const message = error.response?.data?.message ?? error.message;
      toast({ variant: 'destructive', title: 'Registration failed', description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Post-registration: add a member via dialog
  // -------------------------------------------------------------------------
  const handlePostRegAddMember = async (data: PostRegAddMemberData) => {
    if (!household?.id) return;
    setIsAddingMember(true);
    try {
      const response = await api.post(`/portal/household/${household.id}/members`, {
        memberResidentId:   data.memberResidentId,
        relationshipToHead: data.relationshipToHead || null,
        familyGroup:        (data.familyGroup || 'Main Family').trim(),
      });
      toast({ title: 'Member added', description: response.data.member?.name });
      setAddMemberOpen(false);
      postRegForm.reset({ memberResidentId: '', relationshipToHead: '', familyGroup: 'Main Family' });
      loadHousehold();
    } catch (error: any) {
      const message = error.response?.data?.message ?? error.message;
      toast({ variant: 'destructive', title: 'Error', description: message });
    } finally {
      setIsAddingMember(false);
    }
  };

  // -------------------------------------------------------------------------
  // Post-registration: remove a member
  // -------------------------------------------------------------------------
  const handleRemoveMember = async (memberId: string) => {
    if (!household?.id) return;
    try {
      await api.delete(`/portal/household/${household.id}/members/${memberId}`);
      toast({ title: 'Member removed' });
      loadHousehold();
    } catch (error: any) {
      const message = error.response?.data?.message ?? error.message;
      toast({ variant: 'destructive', title: 'Error', description: message });
    }
  };

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------
  if (!isActive) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4">
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <p className="text-yellow-800">
              Your account must be active to register a household. Please wait for your
              registration to be approved.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-center py-12 text-gray-400">Loading household...</div>;
  }

  // -------------------------------------------------------------------------
  // Render: existing household
  // -------------------------------------------------------------------------
  if (household) {
    const isHead = household.house_head === residentId;

    return (
      <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
        <h1 className="text-xl font-bold text-gray-800">My Household</h1>

        {/* Household Information */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Household Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <InfoRow label="House / Lot No."  value={household.house_number} />
            <InfoRow label="Street"            value={household.street} />
            <InfoRow label="Barangay"          value={household.barangay_name} />
            <InfoRow label="Municipality"      value={household.municipality_name} />
            <InfoRow label="Housing Type"      value={household.housing_type} />
            <InfoRow label="Structure Type"    value={household.structure_type} />
            <InfoRow
              label="Electricity"
              value={
                household.electricity === true  ? 'Yes' :
                household.electricity === false ? 'No'  : undefined
              }
            />
            <InfoRow label="Water Source"    value={household.water_source} />
            <InfoRow label="Toilet Facility" value={household.toilet_facility} />
          </CardContent>
        </Card>

        {/* Family Members */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Family Members</CardTitle>
              <CardDescription className="text-xs">
                {isHead
                  ? 'As house head you can add and remove members.'
                  : 'You can remove yourself from this household.'}
              </CardDescription>
            </div>
            {isHead && (
              <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">+ Add Member</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Family Member</DialogTitle>
                  </DialogHeader>
                  <Form {...postRegForm}>
                    <form
                      className="space-y-4"
                      onSubmit={postRegForm.handleSubmit(handlePostRegAddMember)}
                    >
                      <FormField
                        control={postRegForm.control}
                        name="memberResidentId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Resident ID *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="e.g. BIMS-2025-0000002"
                                className="font-mono"
                              />
                            </FormControl>
                            <p className="text-xs text-gray-400">
                              Enter the Resident ID of the person to add.
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={postRegForm.control}
                        name="relationshipToHead"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Relationship to House Head</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select relationship" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {RELATIONSHIPS.map((r) => (
                                  <SelectItem key={r} value={r}>{r}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={postRegForm.control}
                        name="familyGroup"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Family Group</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="e.g. Main Family" />
                            </FormControl>
                            <p className="text-xs text-gray-400">
                              Leave as "Main Family" or type a group name.
                            </p>
                          </FormItem>
                        )}
                      />
                      <Button type="submit" className="w-full" disabled={isAddingMember}>
                        {isAddingMember ? 'Adding...' : 'Add Member'}
                      </Button>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>

          <CardContent>
            {!household.families || household.families.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                No family members yet.{isHead ? ' Use the button above to add members.' : ''}
              </p>
            ) : (
              <div className="space-y-5">
                {household.families.map((family: any) => (
                  <div key={family.family_id}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      {family.family_group}
                    </p>
                    <div className="space-y-2">
                      {(family.members || []).map((m: any) => (
                        <div
                          key={m.member_id}
                          className="flex items-center justify-between border rounded-md px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-medium">{m.resident_name}</p>
                            <p className="text-xs text-gray-500">
                              {m.relationship || 'Member'}
                              <span className="mx-1">·</span>
                              <span className="font-mono">
                                {m.member_resident_id || m.member_id}
                              </span>
                            </p>
                          </div>
                          {(isHead || m.member_id === residentId) && (
                            <button
                              onClick={() => handleRemoveMember(m.member_id)}
                              className="text-xs text-red-500 hover:text-red-700 ml-2"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: registration form (step 1 or step 2)
  // -------------------------------------------------------------------------
  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Register My Household</h1>

      <StepIndicator current={step} total={2} />

      {/* ------------------------------------------------------------------ */}
      {/* STEP 1: Household Information                                        */}
      {/* ------------------------------------------------------------------ */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 1 — Household Information</CardTitle>
            <CardDescription>
              Provide details about your home. All fields are optional except those you know.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...infoForm}>
              <form
                className="space-y-4"
                onSubmit={infoForm.handleSubmit(handleStep1Submit)}
              >
                {/* Address */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Address
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={infoForm.control}
                    name="houseNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>House / Lot No.</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. 12" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={infoForm.control}
                    name="street"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. Rizal St." />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                {/* Housing Details */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Housing Details
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={infoForm.control}
                    name="housingType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Housing Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {HOUSING_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={infoForm.control}
                    name="structureType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Structure Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {STRUCTURE_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                {/* Utilities */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Utilities
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={infoForm.control}
                    name="electricity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Electricity</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Yes">Yes</SelectItem>
                            <SelectItem value="No">No</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={infoForm.control}
                    name="waterSource"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Water Source</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {WATER_SOURCES.map((t) => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={infoForm.control}
                  name="toiletFacility"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Toilet Facility</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TOILET_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full mt-2">
                  Next: Add Family Members
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* STEP 2: Family Members                                               */}
      {/* ------------------------------------------------------------------ */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Summary of step 1 */}
          <Card className="bg-muted/40">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Household Info (Step 1)
              </CardTitle>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs text-primary hover:underline"
              >
                Edit
              </button>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
              {savedInfo?.houseNumber    && <span><b>House No.:</b> {savedInfo.houseNumber}</span>}
              {savedInfo?.street         && <span><b>Street:</b> {savedInfo.street}</span>}
              {savedInfo?.housingType    && <span><b>Housing:</b> {savedInfo.housingType}</span>}
              {savedInfo?.structureType  && <span><b>Structure:</b> {savedInfo.structureType}</span>}
              {savedInfo?.electricity    && <span><b>Electricity:</b> {savedInfo.electricity}</span>}
              {savedInfo?.waterSource    && <span><b>Water:</b> {savedInfo.waterSource}</span>}
              {savedInfo?.toiletFacility && <span><b>Toilet:</b> {savedInfo.toiletFacility}</span>}
            </CardContent>
          </Card>

          {/* Add member inline form */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 2 — Family Members</CardTitle>
              <CardDescription>
                Add family members using their Resident ID (e.g. BIMS-2025-0000002). You can
                also skip this and add them after registration.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Form {...addMemberForm}>
                <form
                  className="space-y-3"
                  onSubmit={addMemberForm.handleSubmit(handleAddPendingMember)}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={addMemberForm.control}
                      name="residentId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Resident ID *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g. BIMS-2025-0000002"
                              className="font-mono text-sm"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={addMemberForm.control}
                      name="relationshipToHead"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Relationship to Head</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select (optional)" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {RELATIONSHIPS.map((r) => (
                                <SelectItem key={r} value={r}>{r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={addMemberForm.control}
                    name="familyGroup"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Family Group</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. Main Family" />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Use the same name to group members together (e.g. "Main Family",
                          "Extended Family").
                        </p>
                      </FormItem>
                    )}
                  />
                  <Button type="submit" variant="outline" size="sm">
                    + Add to List
                  </Button>
                </form>
              </Form>

              {/* Pending member list */}
              {pendingMembers.length > 0 && (
                <>
                  <Separator />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Members to be added ({pendingMembers.length})
                  </p>
                  <div className="space-y-4">
                    {Object.entries(groupByFamily(pendingMembers)).map(([group, members]) => (
                      <div key={group}>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          <Badge variant="secondary" className="text-xs">{group}</Badge>
                        </p>
                        <div className="space-y-1.5">
                          {members.map((m) => (
                            <div
                              key={m.residentId}
                              className="flex items-center justify-between border rounded px-3 py-1.5 text-sm"
                            >
                              <span className="font-mono text-xs">{m.residentId}</span>
                              <span className="text-muted-foreground text-xs mx-2">
                                {m.relationshipToHead || '—'}
                              </span>
                              <button
                                type="button"
                                onClick={() => removePendingMember(m.residentId)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setStep(1)}
              disabled={isSubmitting}
            >
              Back
            </Button>
            <Button
              className="flex-1"
              onClick={handleRegisterHousehold}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Registering...' : 'Register Household'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// InfoRow: labeled field for the household detail view
// ---------------------------------------------------------------------------
const InfoRow: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => {
  if (value === undefined || value === null || value === '') return null;
  return (
    <p>
      <span className="font-medium text-gray-700">{label}:</span>{' '}
      <span className="text-gray-600">{value}</span>
    </p>
  );
};
