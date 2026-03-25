/**
 * RegistrationStatus.tsx — v2
 *
 * Public page: check registration status by username.
 * Accessible without login — for applicants waiting for approval.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { useToast } from '@/hooks/use-toast';
import api from '@/services/api/auth.service';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
});

const STATUS_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  pending: {
    label: 'Pending',
    color: 'bg-yellow-100 text-yellow-800',
    description: 'Your application has been received and is waiting to be reviewed.',
  },
  under_review: {
    label: 'Under Review',
    color: 'bg-blue-100 text-blue-800',
    description: 'Your application is currently being reviewed by the administrator.',
  },
  approved: {
    label: 'Approved',
    color: 'bg-green-100 text-green-800',
    description: 'Your registration has been approved! You can now log in to the portal.',
  },
  rejected: {
    label: 'Rejected',
    color: 'bg-red-100 text-red-800',
    description: 'Your registration was rejected. Please see the admin notes below.',
  },
  requires_resubmission: {
    label: 'Resubmission Required',
    color: 'bg-orange-100 text-orange-800',
    description: 'You need to provide additional information or documents.',
  },
};

export const RegistrationStatus: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [statusData, setStatusData] = useState<any>(null);

  const form = useForm({ resolver: zodResolver(schema), defaultValues: { username: '' } });

  // Pre-fill from URL param
  useEffect(() => {
    const username = searchParams.get('username');
    if (username) {
      form.setValue('username', username);
      handleCheck({ username });
    }
  }, []);

  const handleCheck = async (data: { username: string }) => {
    setIsLoading(true);
    setStatusData(null);
    try {
      const res = await api.get(`/portal-registration/status/${encodeURIComponent(data.username)}`);
      setStatusData(res.data.data);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Not Found',
        description: error.response?.data?.message || 'Registration not found for this username.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const statusInfo = statusData ? STATUS_CONFIG[statusData.registrationStatus] : null;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <img src="/logo-colored.svg" alt="LGU" className="h-10 w-auto" />
              <CardTitle className="text-xl">Check Registration Status</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form className="space-y-4" onSubmit={form.handleSubmit(handleCheck)}>
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Enter your registered username" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Checking...' : 'Check Status'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        {statusData && statusInfo && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800">
                    {statusData.firstName} {statusData.lastName}
                  </p>
                  <p className="text-sm text-gray-500">@{statusData.username}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
              </div>

              <p className="text-sm text-gray-600">{statusInfo.description}</p>

              {statusData.adminNotes && (
                <div className="bg-gray-50 border rounded p-3">
                  <p className="text-xs font-medium text-gray-500 mb-1">Admin Notes</p>
                  <p className="text-sm text-gray-700">{statusData.adminNotes}</p>
                </div>
              )}

              {statusData.registrationStatus === 'approved' && (
                <Button className="w-full" onClick={() => navigate('/portal/login')}>
                  Log In Now
                </Button>
              )}

              {statusData.submittedAt && (
                <p className="text-xs text-gray-400 text-right">
                  Submitted: {new Date(statusData.submittedAt).toLocaleDateString('en-PH')}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="text-center">
          <button
            onClick={() => navigate('/portal/login')}
            className="text-sm text-primary hover:underline"
          >
            ← Back to Login
          </button>
        </div>
      </div>
    </div>
  );
};
