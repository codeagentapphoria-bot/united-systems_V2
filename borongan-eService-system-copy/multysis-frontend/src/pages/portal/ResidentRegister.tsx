/**
 * ResidentRegister.tsx — v2
 *
 * 4-step self-registration wizard for new residents.
 *
 * Step 1: Personal Information
 * Step 2: Address (barangay from DB + street)
 * Step 3: ID Documents + Selfie
 * Step 4: Create Credentials (username + password)
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { PortalHeader } from '@/components/layout/PortalHeader';
import api from '@/services/api/auth.service';

// =============================================================================
// SCHEMAS
// =============================================================================

// Reusable validators
// Matches Filipino/international names: letters (incl. accented), spaces, hyphens, apostrophes, periods
const nameChars = /^[a-zA-ZÀ-ÖØ-öø-ÿñÑ\s'\-.]+$/;
const nameField  = (label: string) =>
  z.string()
    .min(1, `${label} is required`)
    .max(100, `${label} must be at most 100 characters`)
    .regex(nameChars, `${label}: only letters, spaces, hyphens, and apostrophes`);
const optionalName = (maxLen = 100) =>
  z.string().max(maxLen).regex(nameChars, 'Only letters, spaces, hyphens, and apostrophes')
    .optional().or(z.literal(''));
// Philippine mobile: 09XXXXXXXXX
const phPhone = z.string().regex(/^09\d{9}$/, 'Use format: 09XXXXXXXXX').optional().or(z.literal(''));
// Numeric strings (non-negative)
const optionalNumeric = z.string()
  .refine(v => !v || (!isNaN(parseFloat(v)) && parseFloat(v) >= 0), 'Must be a positive number')
  .optional().or(z.literal(''));
// Physical measurement: digits + optional unit letters (e.g. "165 cm", "60kg")
const measurement = z.string()
  .max(20)
  .regex(/^[\d.,\s]*(cm|m|kg|lbs?|ft|in)?$/i, 'Enter a number with optional unit (e.g. 165 cm, 60 kg)')
  .optional().or(z.literal(''));

const step1Schema = z.object({
  firstName:    nameField('First name'),
  middleName:   optionalName(),
  lastName:     nameField('Last name'),
  extensionName: z.string().max(20).optional().or(z.literal('')),
  sex: z.enum(['male', 'female'], { required_error: 'Sex is required' }),
  civilStatus: z.enum(['single','married','widowed','separated','divorced','live_in','annulled'], {
    required_error: 'Civil status is required',
  }),
  birthdate: z.string()
    .min(1, 'Birthdate is required')
    .refine(v => !isNaN(new Date(v).getTime()), 'Invalid date')
    .refine(v => new Date(v) < new Date(), 'Birthdate cannot be in the future')
    .refine(v => new Date(v) >= new Date('1900-01-01'), 'Please enter a valid birthdate'),
  birthRegion:       z.string().max(100).optional().or(z.literal('')),
  birthProvince:     z.string().max(100).optional().or(z.literal('')),
  birthMunicipality: z.string().max(100).optional().or(z.literal('')),
  citizenship:       z.string().max(100).optional().or(z.literal('')),
  contactNumber:     phPhone,
  email:             z.string().email('Invalid email address').optional().or(z.literal('')),
  height:            measurement,
  weight:            measurement,
  occupation:        z.string().max(100).optional().or(z.literal('')),
  profession:        z.string().max(100).optional().or(z.literal('')),
  employmentStatus:  z.enum(['employed','unemployed','self-employed','student','retired']).optional(),
  educationAttainment: z.string().max(100).optional().or(z.literal('')),
  monthlyIncome:     optionalNumeric,
  isVoter:           z.boolean().optional(),
  indigenousPerson:  z.boolean().optional(),
  emergencyContactPerson: optionalName(200),
  emergencyContactNumber: phPhone,
  spouseName:        optionalName(200),
});

const step2Schema = z.object({
  barangayId:    z.string().min(1, 'Barangay is required'),
  streetAddress: z.string().max(255).optional().or(z.literal('')),
});

const step3Schema = z.object({
  idType:          z.string().min(1, 'ID type is required'),
  idDocumentNumber: z.string()
    .min(1, 'ID number is required')
    .max(100, 'ID number is too long')
    .regex(/^[a-zA-Z0-9\s\-]+$/, 'ID number may only contain letters, numbers, spaces, and hyphens'),
  acrNo:           z.string().max(50).optional().or(z.literal('')),
  idDocumentUrl:   z.string().min(1, 'Please upload your ID document'),
  selfieUrl:       z.string().optional(),
  termsAccepted:   z.boolean().refine(v => v, 'You must accept the terms'),
});

const step4Schema = z.object({
  username: z
    .string()
    .min(4, 'Must be at least 4 characters')
    .max(50, 'Must be at most 50 characters')
    .regex(/^[a-z0-9._-]+$/, 'Only lowercase letters, numbers, dots, hyphens, and underscores'),
  password: z.string()
    .min(8, 'Must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;
type Step3Data = z.infer<typeof step3Schema>;
type Step4Data = z.infer<typeof step4Schema>;

const ID_TYPES = [
  'PhilSys National ID',
  'Driver\'s License',
  'Passport',
  'PhilHealth ID',
  'SSS / UMID',
  'GSIS ID',
  'Voter\'s ID',
  'Barangay ID',
  'School ID',
  'Other Government-Issued ID',
];

// =============================================================================
// STEP METADATA
// =============================================================================
const STEPS = [
  { num: 1, title: 'Personal Info',    desc: 'Your basic details & background' },
  { num: 2, title: 'Address',          desc: 'Where you currently reside'      },
  { num: 3, title: 'Identity Docs',    desc: 'Government ID & verification'    },
  { num: 4, title: 'Account Setup',    desc: 'Create your login credentials'   },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================
export const ResidentRegister: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [municipalities, setMunicipalities] = useState<any[]>([]);
  const [barangays, setBarangays] = useState<any[]>([]);
  const [formData, setFormData] = useState<Partial<Step1Data & Step2Data & Step3Data>>({});
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Load municipalities on mount
  useEffect(() => {
    api.get('/addresses/municipalities')
      .then(res => setMunicipalities(res.data.data || []))
      .catch(() => {});
  }, []);

  const step1Form = useForm<Step1Data>({ resolver: zodResolver(step1Schema) });
  const step2Form = useForm<Step2Data>({ resolver: zodResolver(step2Schema) });
  const step3Form = useForm<Step3Data>({ resolver: zodResolver(step3Schema), defaultValues: { termsAccepted: false } });
  const step4Form = useForm<Step4Data>({ resolver: zodResolver(step4Schema) });

  // Load barangays when municipality changes (from step 2 form)
  const handleMunicipalityChange = async (municipalityId: string) => {
    setBarangays([]);
    try {
      const res = await api.get(`/addresses/barangays?municipalityId=${municipalityId}`);
      setBarangays(res.data.data || []);
    } catch {}
  };

  // Check username availability (debounced)
  const checkUsername = async (username: string) => {
    if (username.length < 4) { setUsernameAvailable(null); return; }
    setUsernameChecking(true);
    try {
      const res = await api.get(`/residents/check-username?username=${encodeURIComponent(username)}`);
      setUsernameAvailable(res.data.data?.available ?? false);
    } catch {
      setUsernameAvailable(null);
    } finally {
      setUsernameChecking(false);
    }
  };

  // File to base64
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Upload profile photo and store the returned path in formData
  const handlePhotoUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'File too large', description: 'Max 5MB' });
      return;
    }
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await api.post('/upload/registration/profile-picture', body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Store the absolute URL so both BIMS and eService can display it without
      // prepending a server origin (avoids cross-server path confusion).
      setFormData(prev => ({ ...prev, picturePath: res.data.data.url }));
    } catch {
      toast({ variant: 'destructive', title: 'Photo upload failed', description: 'Please try again.' });
      setPhotoPreview(null);
    } finally {
      setPhotoUploading(false);
    }
  };

  // Step navigation
  const handleStep1 = (data: Step1Data) => {
    setFormData(prev => ({ ...prev, ...data }));
    setStep(2);
  };

  const handleStep2 = (data: Step2Data) => {
    setFormData(prev => ({ ...prev, ...data }));
    setStep(3);
  };

  const handleStep3 = (data: Step3Data) => {
    setFormData(prev => ({ ...prev, ...data }));
    setStep(4);
  };

  const handleStep4 = async (data: Step4Data) => {
    setIsLoading(true);
    try {
      const { termsAccepted: _terms, ...cleanFormData } = formData as any;
      const payload = {
        ...cleanFormData,
        username: data.username,
        password: data.password,
        barangayId: parseInt(formData.barangayId || '0'),
        monthlyIncome: formData.monthlyIncome ? parseFloat(formData.monthlyIncome as string) : undefined,
        isEmployed: ['employed', 'self-employed'].includes((formData as any).employmentStatus || '') || undefined,
      };

      await api.post('/portal-registration/register', payload);

      toast({
        title: 'Registration Submitted!',
        description: 'Your application is pending review. You will be notified when approved.',
      });
      navigate('/portal/register/status?username=' + encodeURIComponent(data.username));
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Registration Failed',
        description: error.response?.data?.message || error.message || 'Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const currentStep = STEPS[step - 1];

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <PortalHeader />

      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT SIDEBAR ─────────────────────────────────────────────── */}
        <aside className="hidden md:flex w-72 lg:w-80 flex-col flex-shrink-0 bg-gradient-to-br from-primary-700 to-primary-900 text-white p-8 overflow-y-auto">
          <div className="mb-8">
            <img src="/logo-white.svg" alt="LGU" className="h-10 w-auto mb-4" onError={e => { (e.target as HTMLImageElement).src = '/logo-colored.svg'; }} />
            <h1 className="text-xl font-bold leading-tight">Resident Self-Registration</h1>
            <p className="text-primary-200 text-sm mt-1">Complete all 4 steps to submit your application.</p>
          </div>

          {/* Step list */}
          <nav className="space-y-2 flex-1">
            {STEPS.map(s => {
              const isDone    = step > s.num;
              const isCurrent = step === s.num;
              return (
                <div
                  key={s.num}
                  className={`flex items-start gap-3 rounded-xl px-4 py-3 transition-colors ${
                    isCurrent ? 'bg-white/20' : isDone ? 'opacity-70' : 'opacity-40'
                  }`}
                >
                  <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    isDone    ? 'bg-green-400 text-green-900'  :
                    isCurrent ? 'bg-white text-primary-700'   :
                                'bg-white/20 text-white'
                  }`}>
                    {isDone ? '✓' : s.num}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${isCurrent ? 'text-white' : 'text-primary-100'}`}>{s.title}</p>
                    <p className="text-xs text-primary-300">{s.desc}</p>
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Bottom tip */}
          <div className="mt-8 bg-white/10 rounded-xl p-4 text-xs text-primary-200 leading-relaxed">
            <p className="font-semibold text-white mb-1">💡 What happens next?</p>
            <p>After submitting, a barangay administrator will review your application. You'll be notified by email once approved.</p>
          </div>
        </aside>

        {/* ── RIGHT CONTENT ─────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-8">

            {/* Mobile step header */}
            <div className="md:hidden mb-6">
              <div className="flex items-center gap-3 mb-3">
                <img src="/logo-colored.svg" alt="LGU" className="h-8 w-auto" />
                <div>
                  <h1 className="font-bold text-gray-800">Resident Registration</h1>
                  <p className="text-xs text-gray-500">Step {step} of 4 — {currentStep.title}</p>
                </div>
              </div>
              <div className="flex gap-1.5">
                {STEPS.map(s => (
                  <div key={s.num} className={`flex-1 h-1 rounded-full ${step >= s.num ? 'bg-primary-600' : 'bg-gray-200'}`} />
                ))}
              </div>
            </div>

            {/* Step heading */}
            <div className="mb-6 pb-4 border-b">
              <h2 className="text-xl font-bold text-gray-800">{currentStep.title}</h2>
              <p className="text-sm text-gray-500">{currentStep.desc}</p>
            </div>

            {/* STEP 1: Personal Information */}
            {step === 1 && (
              <Form {...step1Form}>
                <form className="space-y-5" onSubmit={step1Form.handleSubmit(handleStep1)}>

                  {/* Profile photo + name row */}
                  <div className="flex gap-5 items-start">
                    {/* Photo avatar */}
                    <div className="flex flex-col items-center gap-2 flex-shrink-0">
                      <div
                        className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 overflow-hidden flex items-center justify-center bg-gray-50 cursor-pointer hover:border-primary-500 transition-colors"
                        onClick={() => photoInputRef.current?.click()}
                      >
                        {photoPreview ? (
                          <img src={photoPreview} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-center p-2">
                            <div className="text-2xl text-gray-300">📷</div>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 text-center leading-tight">
                        {photoUploading ? 'Uploading...' : photoPreview ? 'Click to change' : 'Photo (optional)'}
                      </p>
                      <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); }} />
                    </div>

                    {/* Name fields */}
                    <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <FormField control={step1Form.control} name="firstName" render={({ field }) => (
                        <FormItem className="lg:col-span-1"><FormLabel>First Name *</FormLabel><FormControl>
                          <Input {...field} placeholder="Juan" />
                        </FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={step1Form.control} name="lastName" render={({ field }) => (
                        <FormItem className="lg:col-span-1"><FormLabel>Last Name *</FormLabel><FormControl>
                          <Input {...field} placeholder="Dela Cruz" />
                        </FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={step1Form.control} name="middleName" render={({ field }) => (
                        <FormItem className="lg:col-span-1"><FormLabel>Middle Name</FormLabel><FormControl>
                          <Input {...field} placeholder="Santos" />
                        </FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={step1Form.control} name="extensionName" render={({ field }) => (
                        <FormItem className="lg:col-span-1"><FormLabel>Extension</FormLabel><FormControl>
                          <Input {...field} placeholder="Jr. / Sr. / III" />
                        </FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                  </div>

                  {/* Identity row */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <FormField control={step1Form.control} name="sex" render={({ field }) => (
                      <FormItem><FormLabel>Sex *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                          </SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="civilStatus" render={({ field }) => (
                      <FormItem><FormLabel>Civil Status *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {['single','married','widowed','separated','divorced','live_in','annulled'].map(s => (
                              <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_',' ')}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="birthdate" render={({ field }) => (
                      <FormItem><FormLabel>Date of Birth *</FormLabel><FormControl>
                        <Input {...field} type="date" max={new Date().toISOString().split('T')[0]} />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="citizenship" render={({ field }) => (
                      <FormItem><FormLabel>Citizenship</FormLabel><FormControl>
                        <Input {...field} placeholder="e.g. Filipino" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  {/* Contact row */}
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={step1Form.control} name="contactNumber" render={({ field }) => (
                      <FormItem><FormLabel>Contact Number</FormLabel><FormControl>
                        <Input {...field} type="tel" placeholder="09XXXXXXXXX" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="email" render={({ field }) => (
                      <FormItem><FormLabel>Email Address</FormLabel><FormControl>
                        <Input {...field} type="email" placeholder="you@example.com" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  {/* Place of Birth */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Place of Birth</p>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                      <FormField control={step1Form.control} name="birthRegion" render={({ field }) => (
                        <FormItem><FormLabel>Region</FormLabel><FormControl>
                          <Input {...field} placeholder="e.g. Region VIII" />
                        </FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={step1Form.control} name="birthProvince" render={({ field }) => (
                        <FormItem><FormLabel>Province</FormLabel><FormControl>
                          <Input {...field} placeholder="e.g. Eastern Samar" />
                        </FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={step1Form.control} name="birthMunicipality" render={({ field }) => (
                        <FormItem><FormLabel>Municipality / City</FormLabel><FormControl>
                          <Input {...field} placeholder="e.g. Borongan" />
                        </FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                  </div>

                  {/* Physical + Socio-economic */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <FormField control={step1Form.control} name="height" render={({ field }) => (
                      <FormItem><FormLabel>Height</FormLabel><FormControl>
                        <Input {...field} placeholder="e.g. 165 cm" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="weight" render={({ field }) => (
                      <FormItem><FormLabel>Weight</FormLabel><FormControl>
                        <Input {...field} placeholder="e.g. 60 kg" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="occupation" render={({ field }) => (
                      <FormItem><FormLabel>Occupation</FormLabel><FormControl>
                        <Input {...field} placeholder="e.g. Farmer" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="profession" render={({ field }) => (
                      <FormItem><FormLabel>Profession</FormLabel><FormControl>
                        <Input {...field} placeholder="e.g. Licensed Engineer" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <FormField control={step1Form.control} name="employmentStatus" render={({ field }) => (
                      <FormItem><FormLabel>Employment Status</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="employed">Employed</SelectItem>
                            <SelectItem value="self-employed">Self-employed</SelectItem>
                            <SelectItem value="unemployed">Unemployed</SelectItem>
                            <SelectItem value="student">Student</SelectItem>
                            <SelectItem value="retired">Retired</SelectItem>
                          </SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="educationAttainment" render={({ field }) => (
                      <FormItem><FormLabel>Education Attainment</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="No formal education">No Formal Education</SelectItem>
                            <SelectItem value="Elementary">Elementary</SelectItem>
                            <SelectItem value="High School">High School</SelectItem>
                            <SelectItem value="Vocational / Technical">Vocational / Technical</SelectItem>
                            <SelectItem value="College / Undergraduate">College / Undergraduate</SelectItem>
                            <SelectItem value="Graduate / Post-graduate">Graduate / Post-graduate</SelectItem>
                          </SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="monthlyIncome" render={({ field }) => (
                      <FormItem><FormLabel>Monthly Income (PHP)</FormLabel><FormControl>
                        <Input {...field} type="number" min="0" placeholder="e.g. 15000" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  {/* Flags + Emergency + Spouse */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Additional Status</p>
                      <div className="flex gap-6">
                        <FormField control={step1Form.control} name="isVoter" render={({ field }) => (
                          <FormItem className="flex items-center gap-2">
                            <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                            <FormLabel className="cursor-pointer font-normal text-sm">Registered Voter</FormLabel>
                          </FormItem>
                        )} />
                        <FormField control={step1Form.control} name="indigenousPerson" render={({ field }) => (
                          <FormItem className="flex items-center gap-2">
                            <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                            <FormLabel className="cursor-pointer font-normal text-sm">Indigenous Person</FormLabel>
                          </FormItem>
                        )} />
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Emergency Contact</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={step1Form.control} name="emergencyContactPerson" render={({ field }) => (
                          <FormItem><FormLabel>Contact Person</FormLabel><FormControl>
                            <Input {...field} placeholder="Full name" />
                          </FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={step1Form.control} name="emergencyContactNumber" render={({ field }) => (
                          <FormItem><FormLabel>Contact Number</FormLabel><FormControl>
                            <Input {...field} type="tel" placeholder="09XXXXXXXXX" />
                          </FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                    </div>
                  </div>

                  {['married','live_in'].includes(step1Form.watch('civilStatus')) && (
                    <FormField control={step1Form.control} name="spouseName" render={({ field }) => (
                      <FormItem className="max-w-sm"><FormLabel>Spouse Name</FormLabel><FormControl>
                        <Input {...field} placeholder="Full name of spouse" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  )}

                  <div className="pt-2">
                    <Button type="submit" className="w-full h-11">Next: Address →</Button>
                  </div>
                </form>
              </Form>
            )}

            {/* STEP 2: Address */}
            {step === 2 && (
              <Form {...step2Form}>
                <form className="space-y-5 max-w-lg" onSubmit={step2Form.handleSubmit(handleStep2)}>

                  <div className="grid grid-cols-2 gap-3">
                    <FormItem>
                      <FormLabel>Municipality</FormLabel>
                      <Select onValueChange={handleMunicipalityChange}>
                        <SelectTrigger><SelectValue placeholder="Select municipality" /></SelectTrigger>
                        <SelectContent>
                          {municipalities.map((m: any) => (
                            <SelectItem key={m.id} value={String(m.id)}>{m.municipalityName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>

                    <FormField control={step2Form.control} name="barangayId" render={({ field }) => (
                      <FormItem><FormLabel>Barangay *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={barangays.length === 0}>
                          <FormControl><SelectTrigger><SelectValue placeholder={barangays.length === 0 ? 'Select municipality first' : 'Select barangay'} /></SelectTrigger></FormControl>
                          <SelectContent>
                            {barangays.map((b: any) => (
                              <SelectItem key={b.id} value={String(b.id)}>{b.barangayName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage /></FormItem>
                    )} />
                  </div>

                  <FormField control={step2Form.control} name="streetAddress" render={({ field }) => (
                    <FormItem><FormLabel>House / Lot / Street (optional)</FormLabel><FormControl>
                      <Input {...field} placeholder="e.g. Lot 5, Block 2, Rizal Street" />
                    </FormControl><FormMessage /></FormItem>
                  )} />

                  <div className="flex gap-3 pt-2">
                    <Button type="button" variant="outline" className="w-1/2 h-11" onClick={() => setStep(1)}>← Back</Button>
                    <Button type="submit" className="w-1/2 h-11">Next: Documents →</Button>
                  </div>
                </form>
              </Form>
            )}

            {/* STEP 3: ID Documents */}
            {step === 3 && (
              <Form {...step3Form}>
                <form className="space-y-5" onSubmit={step3Form.handleSubmit(handleStep3)}>

                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <FormField control={step3Form.control} name="idType" render={({ field }) => (
                      <FormItem><FormLabel>ID Type *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select ID type" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {ID_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={step3Form.control} name="idDocumentNumber" render={({ field }) => (
                      <FormItem><FormLabel>ID Number *</FormLabel><FormControl>
                        <Input {...field} placeholder="Enter your ID number" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={step3Form.control} name="acrNo" render={({ field }) => (
                      <FormItem><FormLabel>ACR No. <span className="text-gray-400 font-normal">(foreigners)</span></FormLabel><FormControl>
                        <Input {...field} placeholder="Optional" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <FormItem>
                      <FormLabel>Upload ID Document * <span className="text-gray-400 font-normal">(JPG, PNG, PDF — max 5MB)</span></FormLabel>
                      <Input type="file" accept="image/jpeg,image/png,application/pdf"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 5 * 1024 * 1024) {
                            toast({ variant: 'destructive', title: 'File too large', description: 'Max 5MB' });
                            return;
                          }
                          step3Form.setValue('idDocumentUrl', await fileToBase64(file));
                        }} />
                      <FormMessage>{step3Form.formState.errors.idDocumentUrl?.message}</FormMessage>
                    </FormItem>
                    <FormItem>
                      <FormLabel>Selfie with ID <span className="text-gray-400 font-normal">(optional but recommended)</span></FormLabel>
                      <Input type="file" accept="image/jpeg,image/png"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          step3Form.setValue('selfieUrl', await fileToBase64(file));
                        }} />
                    </FormItem>
                  </div>

                  <FormField control={step3Form.control} name="termsAccepted" render={({ field }) => (
                    <FormItem className="flex items-start gap-3 bg-gray-50 border rounded-lg p-4">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div>
                        <FormLabel className="text-sm leading-relaxed cursor-pointer font-normal">
                          I certify that all information provided is true and correct, and I consent to its use for government purposes.
                        </FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )} />

                  <div className="flex gap-3 pt-2">
                    <Button type="button" variant="outline" className="w-1/2 h-11" onClick={() => setStep(2)}>← Back</Button>
                    <Button type="submit" className="w-1/2 h-11">Next: Credentials →</Button>
                  </div>
                </form>
              </Form>
            )}

            {/* STEP 4: Create Credentials */}
            {step === 4 && (
              <Form {...step4Form}>
                <form className="space-y-5 max-w-lg" onSubmit={step4Form.handleSubmit(handleStep4)}>
                  <p className="text-sm text-gray-500">
                    Set up your login credentials. You'll use these to log in to the resident portal after approval.
                  </p>

                  <FormField control={step4Form.control} name="username" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g. juan.delacruz"
                          autoComplete="username"
                          onChange={(e) => {
                            const val = e.target.value.toLowerCase();
                            field.onChange(val);
                            checkUsername(val);
                          }}
                        />
                      </FormControl>
                      {usernameChecking && <p className="text-xs text-gray-400">Checking availability...</p>}
                      {!usernameChecking && usernameAvailable === true  && <p className="text-xs text-green-600">✓ Username is available</p>}
                      {!usernameChecking && usernameAvailable === false && <p className="text-xs text-red-500">✗ Username is already taken</p>}
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={step4Form.control} name="password" render={({ field }) => (
                      <FormItem><FormLabel>Password *</FormLabel><FormControl>
                        <PasswordInput {...field} placeholder="At least 8 characters" autoComplete="new-password" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={step4Form.control} name="confirmPassword" render={({ field }) => (
                      <FormItem><FormLabel>Confirm Password *</FormLabel><FormControl>
                        <PasswordInput {...field} placeholder="Re-enter your password" autoComplete="new-password" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button type="button" variant="outline" className="w-1/2 h-11" onClick={() => setStep(3)} disabled={isLoading}>← Back</Button>
                    <Button type="submit" className="w-1/2 h-11" disabled={isLoading || usernameAvailable === false}>
                      {isLoading ? 'Submitting...' : 'Submit Registration'}
                    </Button>
                  </div>
                </form>
              </Form>
            )}

          </div>
        </main>
      </div>
    </div>
  );
};
