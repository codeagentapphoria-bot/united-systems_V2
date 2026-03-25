/**
 * useResidents.ts
 *
 * Replaces: useSubscribers.ts + useCitizens.ts
 * Manages fetching, pagination, search, and selection of residents
 * from the unified /api/residents endpoint.
 */

import { useDebounce } from '@/hooks/useDebounce';
import { residentService, type Resident, type ResidentFilters } from '@/services/api/resident.service';
import { useCallback, useEffect, useState } from 'react';

export const useResidents = (initialFilters: ResidentFilters = {}) => {
  const [residents, setResidents]               = useState<Resident[]>([]);
  const [isLoading, setIsLoading]               = useState(true);
  const [searchQuery, setSearchQuery]           = useState('');
  const [statusFilter, setStatusFilter]         = useState<string>(initialFilters.status ?? 'all');
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null);
  const [currentPage, setCurrentPage]           = useState(1);
  const [itemsPerPage]                          = useState(initialFilters.limit ?? 10);
  const [totalPages, setTotalPages]             = useState(1);
  const [total, setTotal]                       = useState(0);

  const debouncedSearch = useDebounce(searchQuery, 500);

  const fetchResidents = useCallback(async (page = currentPage) => {
    setIsLoading(true);
    try {
      const filters: ResidentFilters = {
        search:    debouncedSearch   || undefined,
        status:    statusFilter !== 'all' ? statusFilter : undefined,
        page,
        limit:     itemsPerPage,
        barangayId:     initialFilters.barangayId,
        municipalityId: initialFilters.municipalityId,
      };

      const result = await residentService.listResidents(filters);
      setResidents(result.residents);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
    } catch (error) {
      console.error('Failed to fetch residents:', error);
      setResidents([]);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, statusFilter, currentPage, itemsPerPage,
      initialFilters.barangayId, initialFilters.municipalityId]);

  // Re-fetch when search/filter/page changes
  useEffect(() => {
    fetchResidents(currentPage);
  }, [debouncedSearch, statusFilter, currentPage]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const refresh = useCallback(() => {
    fetchResidents(currentPage);
  }, [fetchResidents, currentPage]);

  return {
    // Data
    residents,
    isLoading,
    total,
    totalPages,
    currentPage,
    itemsPerPage,

    // Selection
    selectedResident,
    setSelectedResident,

    // Filters
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,

    // Actions
    handlePageChange,
    refresh,
    fetchResidents,
  };
};
