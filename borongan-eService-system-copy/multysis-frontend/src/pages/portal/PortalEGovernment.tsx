// React imports
import React, { useEffect, useState } from 'react';

// UI Components (shadcn/ui)
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// Custom Components
import { PortalLayout } from '@/components/layout/PortalLayout';
import { LoginPrompt } from '@/components/portal/LoginPrompt';
import { RequestServiceModal } from '@/components/portal/RequestServiceModal';

// Hooks
import { useAuth } from '@/context/AuthContext';
import { useLoginSheet } from '@/context/LoginSheetContext';
import { useSocket } from '@/context/SocketContext';
import { useToast } from '@/hooks/use-toast';

// Services
import { serviceService, type Service } from '@/services/api/service.service';

// Utils
import { useNavigate } from 'react-router-dom';
import { FiArrowRight, FiCalendar, FiChevronLeft, FiChevronRight, FiClipboard, FiFileText, FiLock, FiSearch, FiUser } from 'react-icons/fi';

const BARANGAY_CERT_CATEGORY = 'Barangay Certificate';

export const PortalEGovernment: React.FC = () => {
  const navigate = useNavigate();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { openLoginSheet } = useLoginSheet();
  const { toast } = useToast();
  const { socket, isConnected } = useSocket();
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // For the barangay cert expanded picker
  const [brgyPickerOpen, setBrgyPickerOpen] = useState(false);
  const [selectedBrgyCert, setSelectedBrgyCert] = useState<Service | null>(null);
  const itemsPerPage = 6;

  useEffect(() => {
    const fetchServices = async () => {
      try {
        setIsLoading(true);
        const result = await serviceService.getActiveServices({
          displayInSubscriberTabs: true,
        });
        setServices(result);
      } catch (error: any) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: error.message || 'Failed to fetch services',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchServices();
  }, [toast]);

  // Listen for service:update events to update service status in real-time
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleServiceUpdate = (data: { serviceId: string; isActive?: boolean; name?: string; description?: string; code?: string; category?: string; updatedAt: string }) => {
      setServices((prev) => {
        const index = prev.findIndex((s) => s.id === data.serviceId);
        if (index === -1) {
          if (data.isActive === true) {
            serviceService.getActiveServices({ displayInSubscriberTabs: true })
              .then(setServices)
              .catch((err) => console.error('Failed to refresh services:', err));
          }
          return prev;
        }

        const updated = [...prev];
        if (data.isActive !== undefined) {
          if (data.isActive === false) return prev.filter((s) => s.id !== data.serviceId);
          updated[index] = { ...updated[index], isActive: data.isActive };
        }
        if (data.name !== undefined) updated[index] = { ...updated[index], name: data.name };
        if (data.description !== undefined) updated[index] = { ...updated[index], description: data.description };
        if (data.code !== undefined) updated[index] = { ...updated[index], code: data.code };
        if (data.category !== undefined) updated[index] = { ...updated[index], category: data.category };

        if (selectedService?.id === data.serviceId) setSelectedService(updated[index]);
        return updated;
      });

      if (data.isActive !== undefined) {
        toast({
          title: 'Service Status Updated',
          description: data.isActive ? 'Service is now available.' : 'Service is no longer available.',
        });
      }
    };

    socket.on('service:update', handleServiceUpdate);
    return () => { socket.off('service:update', handleServiceUpdate); };
  }, [socket, isConnected, selectedService, toast]);

  // Split services: barangay certs go into the grouped card; rest are individual cards
  const brgyCertServices = services.filter((s) => s.category === BARANGAY_CERT_CATEGORY);
  const otherServices = services.filter((s) => s.category !== BARANGAY_CERT_CATEGORY);

  // Search applies across both groups
  const searchLower = searchQuery.toLowerCase();
  const filteredBrgy = brgyCertServices.filter(
    (s) => s.name.toLowerCase().includes(searchLower) || s.description?.toLowerCase().includes(searchLower)
  );
  const filteredOther = otherServices.filter(
    (s) => s.name.toLowerCase().includes(searchLower) || s.description?.toLowerCase().includes(searchLower)
  );

  // Build display items: the barangay group card counts as 1 item (if any match)
  // We mix: brgy group card first, then other services
  type DisplayItem = { type: 'brgy-group' } | { type: 'service'; service: Service };
  const allDisplayItems: DisplayItem[] = [
    ...(filteredBrgy.length > 0 ? [{ type: 'brgy-group' as const }] : []),
    ...filteredOther.map((s) => ({ type: 'service' as const, service: s })),
  ];

  const totalPages = Math.ceil(allDisplayItems.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentItems = allDisplayItems.slice(startIndex, startIndex + itemsPerPage);

  const openService = (service: Service) => {
    setSelectedService(service);
    setIsModalOpen(true);
  };

  const ServiceActionButtons: React.FC<{ service: Service }> = ({ service }) => {
    if (isAuthLoading) {
      return <Button disabled className="w-full bg-gray-300 text-gray-500 cursor-not-allowed">Loading...</Button>;
    }
    if (user) {
      return (
        <Button onClick={() => openService(service)} className="w-full bg-primary-600 hover:bg-primary-700 text-white">
          Request Service <FiArrowRight className="ml-2" size={16} />
        </Button>
      );
    }
    return (
      <div className="space-y-2">
        <Button onClick={openLoginSheet} variant="outline" className="w-full border-primary-600 text-primary-600 hover:bg-primary-50">
          Login to Request <FiLock className="ml-2" size={16} />
        </Button>
        <Button
          onClick={() => navigate(`/portal/apply-as-guest?serviceId=${service.id}`)}
          variant="ghost"
          className="w-full text-gray-500 hover:text-gray-700 text-sm"
        >
          <FiUser size={14} className="mr-1.5" /> Apply as Guest
        </Button>
      </div>
    );
  };

  return (
    <PortalLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold text-heading-700 mb-4">E-Government Services</h1>
              <p className="text-lg text-heading-600">
                Access government services and submit requests online.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              <Button
                variant="outline"
                className="text-primary-600 border-primary-600 hover:bg-primary-50 whitespace-nowrap"
                onClick={() => navigate('/portal/track')}
              >
                <FiClipboard size={15} className="mr-1.5" /> Track Application
              </Button>
              {!user && !isAuthLoading && (
                <Button
                  variant="outline"
                  className="text-gray-600 border-gray-300 hover:bg-gray-50 whitespace-nowrap"
                  onClick={() => navigate('/portal/apply-as-guest')}
                >
                  <FiUser size={15} className="mr-1.5" /> Apply as Guest
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-8">
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-heading-400" size={20} />
            <Input
              type="text"
              placeholder="Search services..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="pl-10"
            />
          </div>
        </div>

        {/* Services Grid */}
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-heading-600">Loading services...</p>
          </div>
        ) : allDisplayItems.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-heading-600">No services found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {currentItems.map((item) => {
              if (item.type === 'brgy-group') {
                return (
                  <Card key="brgy-group" className="hover:shadow-lg transition-shadow flex flex-col h-full border-primary-200">
                    <CardHeader>
                      <div className="flex items-center gap-2 mb-2">
                        <FiFileText size={20} className="text-primary-600" />
                        <Badge className="bg-primary-100 text-primary-700 border-primary-200">Barangay Certificate</Badge>
                      </div>
                      <CardTitle className="text-xl text-heading-700">Barangay Certificate Services</CardTitle>
                      <CardDescription className="text-base mt-2">
                        Request official barangay certificates including clearance, indigency, residency, and more.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto space-y-3">
                      {/* Collapsed: show count */}
                      {!brgyPickerOpen ? (
                        <>
                          <p className="text-sm text-heading-500">{filteredBrgy.length} certificates available</p>
                          <Button
                            variant="outline"
                            className="w-full border-primary-600 text-primary-600 hover:bg-primary-50"
                            onClick={() => setBrgyPickerOpen(true)}
                          >
                            View Certificates <FiArrowRight className="ml-2" size={16} />
                          </Button>
                        </>
                      ) : (
                        /* Expanded: pick a certificate */
                        <div className="space-y-2">
                          <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                            {filteredBrgy.map((cert) => (
                              <button
                                key={cert.id}
                                onClick={() => setSelectedBrgyCert(cert)}
                                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors border ${
                                  selectedBrgyCert?.id === cert.id
                                    ? 'bg-primary-600 text-white border-primary-600'
                                    : 'border-gray-200 hover:bg-primary-50 hover:border-primary-300 text-heading-700'
                                }`}
                              >
                                {cert.name}
                              </button>
                            ))}
                          </div>
                          {selectedBrgyCert && (
                            <ServiceActionButtons service={selectedBrgyCert} />
                          )}
                          <button
                            onClick={() => { setBrgyPickerOpen(false); setSelectedBrgyCert(null); }}
                            className="w-full text-xs text-gray-400 hover:text-gray-600 pt-1"
                          >
                            Collapse
                          </button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              }

              const service = item.service;
              return (
                <Card key={service.id} className="hover:shadow-lg transition-shadow flex flex-col h-full">
                  <CardHeader>
                    <div className="flex items-start justify-end mb-4">
                      <div className="flex items-center gap-2">
                        {service.requiresAppointment && (
                          <Badge variant="default" className="bg-blue-600 hover:bg-blue-700 text-white border-blue-700">
                            <FiCalendar size={12} className="mr-1" />
                            Appointment
                          </Badge>
                        )}
                        {!isAuthLoading && !user && (
                          <div className="flex items-center space-x-1 text-orange-600">
                            <FiLock size={16} />
                            <span className="text-xs font-medium">Login Required</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <CardTitle className="text-xl text-heading-700">{service.name}</CardTitle>
                    <CardDescription className="text-base mt-2">
                      {service.description || 'Government service available for online request'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto">
                    <div className="space-y-3">
                      {service.category && (
                        <div className="text-sm">
                          <span className="text-heading-500">Category: </span>
                          <span className="text-heading-700 font-medium">{service.category}</span>
                        </div>
                      )}
                      {service.requiresPayment && (
                        <div className="text-sm">
                          <span className="text-heading-500">Payment Required</span>
                          {service.defaultAmount && !isNaN(Number(service.defaultAmount)) && (
                            <span className="text-heading-700 font-medium ml-2">
                              - ₱{Number(service.defaultAmount).toFixed(2)}
                            </span>
                          )}
                        </div>
                      )}
                      {service.requiresAppointment && (
                        <div className="text-sm text-blue-600 flex items-center">
                          <FiCalendar size={14} className="mr-1" />
                          <span className="font-medium">Appointment Required</span>
                        </div>
                      )}
                      <ServiceActionButtons service={service} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-8">
            <Button
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="flex items-center gap-2"
            >
              <FiChevronLeft size={16} />
              Previous
            </Button>
            <span className="text-sm text-heading-600">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="flex items-center gap-2"
            >
              Next
              <FiChevronRight size={16} />
            </Button>
          </div>
        )}

        {/* Login Prompt Section */}
        {!isAuthLoading && !user && (
          <div className="mt-16">
            <LoginPrompt
              title="Login to Request Services"
              description="Create an account or log in to request government services and track your applications:"
              features={[
                'Submit service requests online',
                'Track application status',
                'Make secure payments',
                'View transaction history',
                'Receive notifications',
              ]}
            />
          </div>
        )}

        {/* Request Service Modal */}
        {selectedService && (
          <RequestServiceModal
            open={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setSelectedService(null);
            }}
            service={selectedService}
            onSuccess={() => {}}
          />
        )}
      </div>
    </PortalLayout>
  );
};
