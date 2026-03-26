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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import api from '@/services/api/auth.service';

// =============================================================================
// SCHEMAS
// =============================================================================

const step1Schema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  middleName: z.string().max(100).optional(),
  lastName: z.string().min(1, 'Last name is required').max(100),
  extensionName: z.string().max(20).optional(),
  sex: z.enum(['male', 'female'], { required_error: 'Sex is required' }),
  civilStatus: z.enum(['single','married','widowed','separated','divorced','live_in','annulled'], {
    required_error: 'Civil status is required',
  }),
  birthdate: z.string().min(1, 'Birthdate is required'),
  contactNumber: z.string().regex(/^09\d{9}$/, 'Use format: 09XXXXXXXXX').optional().or(z.literal('')),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
});

const step2Schema = z.object({
  barangayId: z.string().min(1, 'Barangay is required'),
  streetAddress: z.string().max(255).optional(),
});

const step3Schema = z.object({
  idType: z.string().min(1, 'ID type is required'),
  idDocumentNumber: z.string().min(1, 'ID number is required'),
  idDocumentUrl: z.string().min(1, 'ID document upload is required'),
  selfieUrl: z.string().optional(),
  termsAccepted: z.boolean().refine(v => v, 'You must accept the terms'),
});

const step4Schema = z.object({
  username: z
    .string()
    .min(4, 'Username must be at least 4 characters')
    .max(50)
    .regex(/^[a-z0-9._-]+$/, 'Username can only contain lowercase letters, numbers, dots, hyphens, underscores'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
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
// PROGRESS BAR
// =============================================================================
const StepProgress: React.FC<{ step: number; total: number }> = ({ step, total }) => (
  <div className="flex gap-2 mb-6">
    {Array.from({ length: total }, (_, i) => (
      <div
        key={i}
        className={`flex-1 h-1.5 rounded-full transition-colors ${
          i < step ? 'bg-primary' : 'bg-gray-200'
        }`}
      />
    ))}
  </div>
);

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
      const payload = {
        ...formData,
        username: data.username,
        password: data.password,
        barangayId: parseInt(formData.barangayId || '0'),
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

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3 mb-2">
              <img src="/logo-colored.svg" alt="LGU" className="h-10 w-auto" />
              <div>
                <CardTitle className="text-xl">Resident Registration</CardTitle>
                <p className="text-sm text-gray-500">Step {step} of 4</p>
              </div>
            </div>
            <StepProgress step={step} total={4} />
          </CardHeader>
          <CardContent className="px-6 pb-8">

            {/* STEP 1: Personal Information */}
            {step === 1 && (
              <Form {...step1Form}>
                <form className="space-y-4" onSubmit={step1Form.handleSubmit(handleStep1)}>
                  <h3 className="font-semibold text-gray-700">Personal Information</h3>

                  {/* Profile Photo */}
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className="w-24 h-24 rounded-full border-2 border-dashed border-gray-300 overflow-hidden flex items-center justify-center bg-gray-50 cursor-pointer hover:border-primary transition-colors"
                      onClick={() => photoInputRef.current?.click()}
                    >
                      {photoPreview ? (
                        <img src={photoPreview} alt="Profile preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-center p-2">
                          <div className="text-2xl text-gray-300">📷</div>
                          <p className="text-xs text-gray-400 mt-1">Add Photo</p>
                        </div>
                      )}
                    </div>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handlePhotoUpload(file);
                      }}
                    />
                    <p className="text-xs text-gray-500">
                      {photoUploading
                        ? 'Uploading...'
                        : photoPreview
                        ? 'Click to change photo'
                        : 'Profile photo (optional)'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={step1Form.control} name="firstName" render={({ field }) => (
                      <FormItem><FormLabel>First Name *</FormLabel><FormControl>
                        <Input {...field} placeholder="Juan" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="lastName" render={({ field }) => (
                      <FormItem><FormLabel>Last Name *</FormLabel><FormControl>
                        <Input {...field} placeholder="Dela Cruz" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={step1Form.control} name="middleName" render={({ field }) => (
                      <FormItem><FormLabel>Middle Name</FormLabel><FormControl>
                        <Input {...field} placeholder="Santos" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="extensionName" render={({ field }) => (
                      <FormItem><FormLabel>Extension (Jr./Sr./III)</FormLabel><FormControl>
                        <Input {...field} placeholder="Jr." />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={step1Form.control} name="sex" render={({ field }) => (
                      <FormItem><FormLabel>Sex *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage /></FormItem>
                    )} />
                    <FormField control={step1Form.control} name="civilStatus" render={({ field }) => (
                      <FormItem><FormLabel>Civil Status *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {['single','married','widowed','separated','divorced','live_in','annulled'].map(s => (
                              <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage /></FormItem>
                    )} />
                  </div>
                  <FormField control={step1Form.control} name="birthdate" render={({ field }) => (
                    <FormItem><FormLabel>Date of Birth *</FormLabel><FormControl>
                      <Input {...field} type="date" max={new Date().toISOString().split('T')[0]} />
                    </FormControl><FormMessage /></FormItem>
                  )} />
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
                  <Button type="submit" className="w-full h-11">Next: Address</Button>
                </form>
              </Form>
            )}

            {/* STEP 2: Address */}
            {step === 2 && (
              <Form {...step2Form}>
                <form className="space-y-4" onSubmit={step2Form.handleSubmit(handleStep2)}>
                  <h3 className="font-semibold text-gray-700">Current Address</h3>

                  {/* Municipality selector */}
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

                  <FormField control={step2Form.control} name="streetAddress" render={({ field }) => (
                    <FormItem><FormLabel>House/Lot/Street (optional)</FormLabel><FormControl>
                      <Input {...field} placeholder="e.g. Lot 5, Block 2, Rizal Street" />
                    </FormControl><FormMessage /></FormItem>
                  )} />

                  <div className="flex gap-3">
                    <Button type="button" variant="outline" className="w-1/2 h-11" onClick={() => setStep(1)}>Back</Button>
                    <Button type="submit" className="w-1/2 h-11">Next: Documents</Button>
                  </div>
                </form>
              </Form>
            )}

            {/* STEP 3: ID Documents */}
            {step === 3 && (
              <Form {...step3Form}>
                <form className="space-y-4" onSubmit={step3Form.handleSubmit(handleStep3)}>
                  <h3 className="font-semibold text-gray-700">ID Documents</h3>

                  <FormField control={step3Form.control} name="idType" render={({ field }) => (
                    <FormItem><FormLabel>ID Type *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select ID type" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {ID_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage /></FormItem>
                  )} />

                  <FormField control={step3Form.control} name="idDocumentNumber" render={({ field }) => (
                    <FormItem><FormLabel>ID Number *</FormLabel><FormControl>
                      <Input {...field} placeholder="Enter your ID number" />
                    </FormControl><FormMessage /></FormItem>
                  )} />

                  <FormItem>
                    <FormLabel>Upload ID Document * (JPG, PNG, PDF — max 5MB)</FormLabel>
                    <Input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 5 * 1024 * 1024) {
                          toast({ variant: 'destructive', title: 'File too large', description: 'Max 5MB' });
                          return;
                        }
                        const b64 = await fileToBase64(file);
                        step3Form.setValue('idDocumentUrl', b64);
                      }}
                    />
                    <FormMessage>{step3Form.formState.errors.idDocumentUrl?.message}</FormMessage>
                  </FormItem>

                  <FormItem>
                    <FormLabel>Selfie with ID (optional but recommended)</FormLabel>
                    <Input
                      type="file"
                      accept="image/jpeg,image/png"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const b64 = await fileToBase64(file);
                        step3Form.setValue('selfieUrl', b64);
                      }}
                    />
                  </FormItem>

                  <FormField control={step3Form.control} name="termsAccepted" render={({ field }) => (
                    <FormItem className="flex items-start gap-3">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div>
                        <FormLabel className="text-sm leading-tight cursor-pointer">
                          I certify that all information provided is true and correct, and I consent to its use for government purposes.
                        </FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )} />

                  <div className="flex gap-3">
                    <Button type="button" variant="outline" className="w-1/2 h-11" onClick={() => setStep(2)}>Back</Button>
                    <Button type="submit" className="w-1/2 h-11">Next: Credentials</Button>
                  </div>
                </form>
              </Form>
            )}

            {/* STEP 4: Create Credentials */}
            {step === 4 && (
              <Form {...step4Form}>
                <form className="space-y-4" onSubmit={step4Form.handleSubmit(handleStep4)}>
                  <h3 className="font-semibold text-gray-700">Create Your Account</h3>
                  <p className="text-sm text-gray-500">
                    Set up your login credentials. You'll use these to log in to the resident portal.
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
                            field.onChange(e);
                            const val = e.target.value.toLowerCase();
                            field.onChange(val);
                            checkUsername(val);
                          }}
                        />
                      </FormControl>
                      {usernameChecking && <p className="text-xs text-gray-400">Checking...</p>}
                      {!usernameChecking && usernameAvailable === true && (
                        <p className="text-xs text-green-600">✓ Username is available</p>
                      )}
                      {!usernameChecking && usernameAvailable === false && (
                        <p className="text-xs text-red-500">✗ Username is already taken</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )} />

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

                  <div className="flex gap-3">
                    <Button type="button" variant="outline" className="w-1/2 h-11" onClick={() => setStep(3)} disabled={isLoading}>Back</Button>
                    <Button
                      type="submit"
                      className="w-1/2 h-11"
                      disabled={isLoading || usernameAvailable === false}
                    >
                      {isLoading ? 'Submitting...' : 'Submit Registration'}
                    </Button>
                  </div>
                </form>
              </Form>
            )}

          </CardContent>
        </Card>
      </div>
    </div>
  );
};
