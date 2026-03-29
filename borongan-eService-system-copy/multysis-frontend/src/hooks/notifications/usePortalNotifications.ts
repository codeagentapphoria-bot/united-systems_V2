// React imports
import { useCallback, useEffect, useRef, useState } from 'react';

// Services
import {
  notificationService,
  type SubscriberNotificationCounts,
} from '@/services/api/notification.service';

// Hooks
import { useToast } from '@/hooks/use-toast';

// Context
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';

// Types
import type { TransactionUpdatePayload, TransactionNoteResponse } from '@/types/socket.types';

interface UsePortalNotificationsOptions {
  pollInterval?: number; // Polling interval in milliseconds (default: 30000 = 30 seconds)
  autoFetch?: boolean; // Whether to automatically fetch on mount
  enabled?: boolean; // Whether polling is enabled (pauses when tab is not visible)
}

interface UsePortalNotificationsReturn {
  counts: SubscriberNotificationCounts;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const EMPTY_COUNTS: SubscriberNotificationCounts = {
  pendingUpdateRequests: 0,
  unreadMessages: 0,
  statusUpdates: 0,
  total: 0,
};

export const usePortalNotifications = ({
  pollInterval = 30000, // 30 seconds default
  autoFetch = true,
  enabled = true,
}: UsePortalNotificationsOptions = {}): UsePortalNotificationsReturn => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { socket, isConnected } = useSocket();
  const [counts, setCounts] = useState<SubscriberNotificationCounts>(EMPTY_COUNTS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWebSocketHealthy, setIsWebSocketHealthy] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const lastEventTimeRef = useRef<number>(Date.now());
  const healthCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCounts = useCallback(async () => {
    // Only fetch if user is subscriber
    if (!user || user.role !== 'resident') {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await notificationService.getSubscriberNotificationCounts();
      if (isMountedRef.current) {
        setCounts(result);
      }
    } catch (err: any) {
      const errorMessage =
        err.response?.data?.message || err.message || 'Failed to fetch notification counts';
      if (isMountedRef.current) {
        setError(errorMessage);
        // Only show toast on initial error, not on polling errors
        if (!intervalRef.current) {
          toast({
            variant: 'destructive',
            title: 'Error',
            description: errorMessage,
          });
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [user, toast]);

  // WebSocket health monitoring
  useEffect(() => {
    if (!socket || !isConnected || !user || user.role !== 'resident') {
      return;
    }

    healthCheckIntervalRef.current = setInterval(() => {
      const timeSinceLastEvent = Date.now() - lastEventTimeRef.current;
      const healthThreshold = 60000; // 60 seconds

      if (timeSinceLastEvent > healthThreshold) {
        if (isWebSocketHealthy) {
          setIsWebSocketHealthy(false);
        }
      }
    }, 30000);

    return () => {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
        healthCheckIntervalRef.current = null;
      }
    };
  }, [socket, isConnected, user, isWebSocketHealthy]);

  // Listen for WebSocket events to update counts incrementally
  useEffect(() => {
    if (!socket || !isConnected || !user || user.role !== 'resident') {
      return;
    }

    const updateLastEventTime = () => {
      lastEventTimeRef.current = Date.now();
      if (!isWebSocketHealthy) {
        setIsWebSocketHealthy(true);
      }
    };

    const handleTransactionUpdate = (data: TransactionUpdatePayload) => {
      updateLastEventTime();
      setCounts((prev) => {
        const updated = { ...prev };
        
        // Handle status updates (affects statusUpdates)
        if (data.status !== undefined && data.oldStatus !== undefined && 
            data.status !== data.oldStatus) {
          updated.statusUpdates += 1;
          updated.total += 1;
        }
        
        // Handle payment status changes
        if (data.paymentStatus !== undefined && data.oldPaymentStatus !== undefined && 
            data.paymentStatus !== data.oldPaymentStatus) {
          // When payment status changes, it could affect pendingUpdateRequests
          if (data.oldPaymentStatus === 'PAID' && data.paymentStatus !== 'PAID') {
            updated.pendingUpdateRequests += 1;
            updated.total += 1;
          } else if (data.oldPaymentStatus !== 'PAID' && data.paymentStatus === 'PAID') {
            updated.pendingUpdateRequests = Math.max(0, updated.pendingUpdateRequests - 1);
            updated.total = Math.max(0, updated.total - 1);
          }
        }
        
        return updated;
      });
    };

    const handleNewTransactionNote = (data: TransactionNoteResponse) => {
      updateLastEventTime();
      // Only count if it's from admin (subscriber cares about admin messages)
      if (data.senderType === 'ADMIN' && !data.isRead) {
        setCounts((prev) => ({
          ...prev,
          unreadMessages: prev.unreadMessages + 1,
          total: prev.total + 1,
        }));
      }
    };

    const handleTransactionNoteRead = (data: { transactionId: string; senderType: 'ADMIN' | 'SUBSCRIBER'; isRead: boolean }) => {
      updateLastEventTime();
      // When admin reads subscriber's message
      if (data.senderType === 'SUBSCRIBER' && data.isRead) {
        setCounts((prev) => ({
          ...prev,
          unreadMessages: Math.max(0, prev.unreadMessages - 1),
          total: Math.max(0, prev.total - 1),
        }));
      }
    };

    const handleNotification = () => {
      updateLastEventTime();
      fetchCounts();
    };

    socket.on('transaction:update', handleTransactionUpdate);
    socket.on('transaction:note:new', handleNewTransactionNote);
    socket.on('transaction:note:read', handleTransactionNoteRead);
    socket.on('notification:new', handleNotification);

    return () => {
      socket.off('transaction:update', handleTransactionUpdate);
      socket.off('transaction:note:new', handleNewTransactionNote);
      socket.off('transaction:note:read', handleTransactionNoteRead);
      socket.off('notification:new', handleNotification);
    };
  }, [socket, isConnected, user, fetchCounts, isWebSocketHealthy]);

  // Set up polling with dynamic interval based on WebSocket health
  useEffect(() => {
    if (!autoFetch || !enabled || !user || user.role !== 'resident') {
      return;
    }

    const effectivePollInterval = isWebSocketHealthy ? pollInterval : 15000;

    // Initial fetch
    fetchCounts();

    // Set up polling interval
    intervalRef.current = setInterval(() => {
      if (enabled && isMountedRef.current) {
        fetchCounts();
      }
    }, effectivePollInterval);

    // Cleanup interval on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoFetch, enabled, pollInterval, fetchCounts, user, isWebSocketHealthy]);

  // Handle page visibility changes (pause polling when tab is not visible)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden, pause polling
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        // Tab is visible, resume polling
        if (autoFetch && enabled && user && user.role === 'resident' && !intervalRef.current) {
          fetchCounts();
          const effectivePollInterval = isWebSocketHealthy ? pollInterval : 15000;
          intervalRef.current = setInterval(() => {
            if (enabled && isMountedRef.current) {
              fetchCounts();
            }
          }, effectivePollInterval);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoFetch, enabled, pollInterval, fetchCounts, user, isWebSocketHealthy]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
        healthCheckIntervalRef.current = null;
      }
    };
  }, []);

  const refresh = useCallback(async () => {
    await fetchCounts();
  }, [fetchCounts]);

  return {
    counts,
    isLoading,
    error,
    refresh,
  };
};

