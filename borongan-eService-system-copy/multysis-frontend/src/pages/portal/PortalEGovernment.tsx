// React imports
import React, { useEffect, useMemo, useState } from 'react';

// UI Components (shadcn/ui)
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// Custom Components
import { PortalLayout } from '@/components/layout/PortalLayout';
import { RequestServiceModal } from '@/components/portal/RequestServiceModal';
import { CategoryServicesModal } from '@/components/portal/CategoryServicesModal';

// Hooks
import { useAuth } from '@/context/AuthContext';
import { useLoginSheet } from '@/context/LoginSheetContext';
import { useSocket } from '@/context/SocketContext';
import { useToast } from '@/hooks/use-toast';

// Services
import { serviceService, type Service } from '@/services/api/service.service';

// Utils
import { useNavigate } from 'react-router-dom';
import { FiArrowRight, FiChevronLeft, FiChevronRight, FiClipboard, FiFileText, FiSearch, FiUser } from 'react-icons/fi';

export const PortalEGovernment: React.FC = () => {
  const navigate = useNavigate();
  const { user, isLoading: isAuthLoading } = useAuth();
  useLoginSheet();
  const { toast } = useToast();
  const { socket, isConnected } = useSocket();
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Category modal state
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [categoryServices, setCategoryServices] = useState<Service[]>([]);

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

  // Group services by category
  const servicesByCategory = useMemo(() => {
    const groups: Record<string, Service[]> = {};

    services.forEach((service) => {
      const category = service.category || 'Other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(service);
    });

    // Sort services within each category by order
    Object.keys(groups).forEach((category) => {
      groups[category].sort((a, b) => a.order - b.order);
    });

    return groups;
  }, [services]);

  // Category order preference
  const categoryOrder = ['Barangay Certificate', 'Civil Registry', 'Tax', 'Health', 'Business', 'Permit', 'Other'];

  const sortedCategories = useMemo(() => {
    const categories = Object.keys(servicesByCategory);
    return categories.sort((a, b) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);

      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [servicesByCategory]);

  // Search filter
  const searchLower = searchQuery.toLowerCase();
  const filteredCategories = useMemo(() => {
    if (!searchLower) return sortedCategories;

    return sortedCategories.filter((category) => {
      const categoryServices = servicesByCategory[category];
      return categoryServices.some(
        (s) =>
          s.name.toLowerCase().includes(searchLower) ||
          s.description?.toLowerCase().includes(searchLower)
      );
    });
  }, [sortedCategories, servicesByCategory, searchLower]);

  // Build display items
  type DisplayItem = { type: 'category'; category: string; services: Service[] };
  const allDisplayItems: DisplayItem[] = filteredCategories.map((category) => ({
    type: 'category' as const,
    category,
    services: servicesByCategory[category].filter(
      (s) =>
        !searchLower ||
        s.name.toLowerCase().includes(searchLower) ||
        s.description?.toLowerCase().includes(searchLower)
    ),
  })).filter((item) => item.services.length > 0);

  const totalPages = Math.ceil(allDisplayItems.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentItems = allDisplayItems.slice(startIndex, startIndex + itemsPerPage);

  const openCategoryModal = (category: string, categoryServicesList: Service[]) => {
    setSelectedCategory(category);
    setCategoryServices(categoryServicesList);
    setIsCategoryModalOpen(true);
  };

  const getCategoryDescription = (cat: string) => {
    const descriptions: Record<string, string> = {
      'Barangay Certificate': 'Request official barangay certificates including clearance, indigency, residency, and more.',
      'Civil Registry': 'Birth, marriage, and death certificate services.',
      'Tax': 'Community tax certificates and real property tax services.',
      'Health': 'Occupational health and medical certificate services.',
      'Business': 'Business permits, licensing, and related business services.',
      'Permit': 'Permits and licensing for various business activities.',
      'Other': 'Other government services.',
    };
    return descriptions[cat] || `Services related to ${cat}`;
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
              const category = item.category;
              const categoryServicesList = item.services;

              return (
                <Card
                  key={category}
                  className="hover:shadow-lg transition-shadow flex flex-col h-full border-primary-200 cursor-pointer"
                  onClick={() => openCategoryModal(category, categoryServicesList)}
                >
                  <CardHeader>
                    <div className="flex items-center gap-2 mb-2">
                      <FiFileText size={20} className="text-primary-600" />
                      <Badge className="bg-primary-100 text-primary-700 border-primary-200">
                        {category}
                      </Badge>
                    </div>
                    <CardTitle className="text-xl text-heading-700">{category} Services</CardTitle>
                    <CardDescription className="text-base mt-2">
                      {getCategoryDescription(category)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto">
                    <p className="text-sm text-heading-500 mb-4">
                      {categoryServicesList.length} service{categoryServicesList.length !== 1 ? 's' : ''} available
                    </p>
                    <Button
                      variant="outline"
                      className="w-full border-primary-600 text-primary-600 hover:bg-primary-50"
                    >
                      View Services <FiArrowRight className="ml-2" size={16} />
                    </Button>
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

        {/* Request Service Modal */}
        {selectedService && (
          <RequestServiceModal
            open={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setSelectedService(null);
            }}
            service={selectedService}
            onSuccess={() => { }}
          />
        )}

        {/* Category Services Modal */}
        <CategoryServicesModal
          open={isCategoryModalOpen}
          onClose={() => {
            setIsCategoryModalOpen(false);
            setSelectedCategory('');
            setCategoryServices([]);
          }}
          category={selectedCategory}
          services={categoryServices}
        />
      </div>
    </PortalLayout>
  );
};