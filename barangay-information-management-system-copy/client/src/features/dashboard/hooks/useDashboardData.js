import { useState, useEffect, useCallback, useRef } from "react";
import useAuth from "@/hooks/useAuth";
import api from "@/utils/api";
import { registerCache } from "@/utils/cacheManager";

// Cache for storing API responses
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Request deduplication
const pendingRequests = new Map();

// Register cache with global cache manager
registerCache(cache, 'dashboard-data');
registerCache(pendingRequests, 'dashboard-pending-requests');

// Helper function to generate cache key
const getCacheKey = (endpoint, params = {}) => {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  return `${endpoint}?${sortedParams}`;
};

// Helper function to check if cache is valid
const isCacheValid = (timestamp) => {
  return Date.now() - timestamp < CACHE_DURATION;
};

// Optimized API call with caching and deduplication
const cachedApiCall = async (endpoint, params = {}) => {
  const cacheKey = getCacheKey(endpoint, params);

  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.data;
  }

  // Check if request is already pending
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  // Make new request
  const requestPromise = api.get(endpoint, { params })
    .then(response => {
    // Cache the response
    cache.set(cacheKey, {
      data: response.data,
      timestamp: Date.now()
    });
    pendingRequests.delete(cacheKey);
    return response.data;
  })
    .catch(error => {
      pendingRequests.delete(cacheKey);
      if (process.env.NODE_ENV === 'development') {
        if (process.env.NODE_ENV === 'development') {
  console.error("Request failed for:", cacheKey, error);
}
      }
      throw error;
    });

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
};

export const useDashboardData = (role, selectedBarangay) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [barangays, setBarangays] = useState([]);

  // Statistics state
  const [stats, setStats] = useState({
    population: { total: 0, male: 0, female: 0, addedThisMonth: 0 },
    households: { total: 0, addedThisMonth: 0 },
    families: { total: 0, addedThisMonth: 0 },
    pets: { total: 0, addedThisMonth: 0 },
    unemployedHouseholds: { total: 0, affected: 0, percentage: 0 },
  });

  // Demographics state
  const [demographics, setDemographics] = useState({
    age: [],
    gender: [],
    civilStatus: [],
    education: [],
    employment: [],
    classifications: [],
    voters: [],
  });

  // Distribution data state
  const [distributionData, setDistributionData] = useState({
    demographics: [],
    employment: [],
    education: [],
    voters: [],
  });

  // Refs to track if data is stale
  const lastFetchRef = useRef({});
  const abortControllerRef = useRef(null);

  // Helper function to build params with barangay filter for barangay role
  const buildParams = useCallback(() => {
    const params = {};

    // For barangay role, always include barangayId filter
    if (role === "barangay") {
      params.barangayId = user?.target_id;
    } else if (selectedBarangay) {
      // For municipality role, only include if barangay is selected
      params.barangayId = selectedBarangay;
    }

    return params;
  }, [role, selectedBarangay, user?.target_id]);

  // Helper function to safely parse numbers and handle NaN
  const safeParseInt = (value, defaultValue = 0) => {
    if (value === null || value === undefined || value === "")
      return defaultValue;
    const parsed = parseInt(value);
    return isNaN(parsed) ? defaultValue : parsed;
  };

  // Helper function to safely parse floats and handle NaN
  const safeParseFloat = (value, defaultValue = 0) => {
    if (value === null || value === undefined || value === "")
      return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  };

  // Fetch barangays for municipality role (cached)
  const fetchBarangays = useCallback(async () => {
    if (role !== "municipality") return;
    try {
      const response = await cachedApiCall("/list/barangay?perPage=200");
      const barangayData = response.data.data || [];
      setBarangays(barangayData);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        if (process.env.NODE_ENV === 'development') {
  console.error("Error fetching barangays:", error);
}
      }
      setBarangays([]);
    }
  }, [role]);

  // Fetch all statistics in parallel (cached)
  const fetchStatistics = useCallback(async () => {
      const params = buildParams();

    try {
      const [
        populationRes,
        householdsRes,
        familiesRes,
        petsRes,
        unemployedRes
      ] = await Promise.all([
        cachedApiCall("/statistics/total-population", params),
        cachedApiCall("/statistics/total-households", params),
        cachedApiCall("/statistics/total-families", params),
        cachedApiCall("/statistics/total-registered-pets", params),
        cachedApiCall("/statistics/unemployed-household-stats", params)
      ]);

      setStats({
        population: {
          total: safeParseInt(populationRes.data?.total_population, 0),
          male: safeParseInt(populationRes.data?.total_male, 0),
          female: safeParseInt(populationRes.data?.total_female, 0),
          addedThisMonth: safeParseInt(populationRes.data?.added_this_month, 0),
        },
        households: {
          total: safeParseInt(householdsRes.data?.total_households, 0),
          addedThisMonth: safeParseInt(householdsRes.data?.added_this_month, 0),
        },
        families: {
          total: safeParseInt(familiesRes.data?.total_families, 0),
          addedThisMonth: safeParseInt(familiesRes.data?.added_this_month, 0),
        },
        pets: {
          total: safeParseInt(petsRes.data?.total_pets, 0),
          addedThisMonth: safeParseInt(petsRes.data?.added_this_month, 0),
        },
        unemployedHouseholds: {
          total: safeParseInt(unemployedRes.data?.total_households, 0),
          affected: safeParseInt(unemployedRes.data?.households_with_unemployed, 0),
          percentage: safeParseFloat(unemployedRes.data?.percentage_households_with_unemployed, 0),
        },
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        if (process.env.NODE_ENV === 'development') {
  console.error("Error fetching statistics:", error);
}
      }
    }
  }, [buildParams]);

  // Fetch demographics data in parallel (cached)
  const fetchDemographics = useCallback(async () => {
      const params = buildParams();

    try {
      const [
        ageRes,
        genderRes,
        civilStatusRes,
        educationRes,
        employmentRes,
        classificationsRes,
        votersRes,
      ] = await Promise.all([
        cachedApiCall("/statistics/age-demographics", params),
        cachedApiCall("/statistics/gender-demographics", params),
        cachedApiCall("/statistics/civil-status-demographics", params),
        cachedApiCall("/statistics/educational-attainment-demographics", params),
        cachedApiCall("/statistics/employment-status-demographics", params),
        cachedApiCall("/statistics/resident-classification-demographics", params),
        cachedApiCall("/statistics/voter-demographics", params),
      ]);

      setDemographics({
        age: ageRes.data || [],
        gender: genderRes.data || [],
        civilStatus: civilStatusRes.data || [],
        education: educationRes.data || [],
        employment: employmentRes.data || [],
        classifications: classificationsRes.data || [],
        voters: votersRes.data || [],
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        if (process.env.NODE_ENV === 'development') {
  console.error("Error fetching demographics:", error);
}
      }
      setDemographics({
        age: [],
        gender: [],
        civilStatus: [],
        education: [],
        employment: [],
        classifications: [],
        voters: [],
      });
    }
  }, [buildParams]);

  // Fetch distribution data by barangay
  const fetchDistributionData = useCallback(async () => {
    try {
      let barangaysList = [];
      if (role === "municipality") {
        if (selectedBarangay) {
          // A specific barangay is selected — only fetch for that one
          const allBarangays = (await cachedApiCall("/list/barangay?perPage=200")).data.data || [];
          barangaysList = allBarangays.filter(b => b.id.toString() === selectedBarangay.toString());
        } else {
          barangaysList = (await cachedApiCall("/list/barangay?perPage=200")).data.data || [];
        }
      } else if (role === "barangay" && user?.target_id) {
        barangaysList = [{ id: user.target_id, barangay_name: "This Barangay" }];
      }

      if (barangaysList.length === 0) {
        setDistributionData({ demographics: [], employment: [], education: [], voters: [] });
        return;
      }

      const statsPromises = barangaysList.map(async (barangay) => {
        try {
          const params = { barangayId: barangay.id };
          const [demoRes, empRes, eduRes, voterRes] = await Promise.all([
            cachedApiCall("/statistics/gender-demographics", params),
            cachedApiCall("/statistics/employment-status-demographics", params),
            cachedApiCall("/statistics/educational-attainment-demographics", params),
            cachedApiCall("/statistics/voter-demographics", params),
          ]);

          const genderData = demoRes.data || [];
          const employmentData = empRes.data || [];
          const educationData = eduRes.data || [];
          const voterData = voterRes.data || [];

          return {
            name: barangay.barangay_name || "Unknown Barangay",
            male: safeParseInt(genderData.find(item => item.sex === "male")?.count, 0),
            female: safeParseInt(genderData.find(item => item.sex === "female")?.count, 0),
            employed: safeParseInt(employmentData.find(item => item.employment_status === "employed")?.count, 0),
            unemployed: safeParseInt(employmentData.find(item => item.employment_status === "unemployed")?.count, 0),
            student: safeParseInt(employmentData.find(item => item.employment_status === "student")?.count, 0),
            retired: safeParseInt(employmentData.find(item => item.employment_status === "retired")?.count, 0),
            elementary: safeParseInt(educationData.find(item => item.education_attainment === "elementary")?.count, 0),
            high_school: safeParseInt(educationData.find(item => item.education_attainment === "high_school_graduate")?.count, 0),
            college: safeParseInt(educationData.find(item => item.education_attainment === "college_graduate")?.count, 0),
            post_graduate: safeParseInt(educationData.find(item => item.education_attainment === "post_graduate")?.count, 0),
            regular_voter: safeParseInt(voterData.find(item => item.voter_type === "Regular Voter")?.count, 0),
            sk_voter: safeParseInt(voterData.find(item => item.voter_type === "SK Voter")?.count, 0),
            other_voter: safeParseInt(voterData.find(item => item.voter_type === "Other Voter")?.count, 0),
          };
        } catch {
          return {
            name: barangay.barangay_name || "Unknown Barangay",
            male: 0, female: 0, employed: 0, unemployed: 0, student: 0, retired: 0,
            elementary: 0, high_school: 0, college: 0, post_graduate: 0,
            regular_voter: 0, sk_voter: 0, other_voter: 0,
          };
        }
      });

      const stats = await Promise.all(statsPromises);

      setDistributionData({
        demographics: stats.map(s => ({ name: s.name, male: s.male, female: s.female, value: s.male + s.female })),
        employment: stats.map(s => ({ name: s.name, employed: s.employed, unemployed: s.unemployed, student: s.student, retired: s.retired, value: s.employed + s.unemployed + s.student + s.retired })),
        education: stats.map(s => ({ name: s.name, elementary: s.elementary, high_school: s.high_school, college: s.college, post_graduate: s.post_graduate, value: s.elementary + s.high_school + s.college + s.post_graduate })),
        voters: stats.map(s => ({ name: s.name, regular_voter: s.regular_voter, sk_voter: s.sk_voter, other_voter: s.other_voter, value: s.regular_voter + s.sk_voter + s.other_voter })),
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Error fetching distribution data:", error);
      }
      setDistributionData({ demographics: [], employment: [], education: [], voters: [] });
    }
  }, [role, selectedBarangay, user?.target_id]);

  // Load all dashboard data with optimization
  const loadDashboardData = useCallback(async () => {
    // Cancel previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    setLoading(true);
    try {
      await Promise.all([
        fetchBarangays(),
        fetchStatistics(),
        fetchDemographics(),
        fetchDistributionData(),
      ]);
    } catch (error) {
      if (error.name !== 'AbortError') {
        if (process.env.NODE_ENV === 'development') {
          console.error("loadDashboardData (cached) error:", error);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [fetchBarangays, fetchStatistics, fetchDemographics, fetchDistributionData]);

  // Effect to reload data when filters change
  useEffect(() => {
    loadDashboardData();
  }, [selectedBarangay, role, user?.target_id, loadDashboardData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    loading,
    stats,
    demographics,
    distributionData,
    barangays,
    loadDashboardData,
  };
};
