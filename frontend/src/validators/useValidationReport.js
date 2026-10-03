// frontend/src/validators/useValidationReport.js

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, API_BASE_URL } from '../config/api.js';

export function useValidationReport(jobId, options = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const inFlightRef = useRef(false);
  const abortControllerRef = useRef(null);

  const refetchInterval = typeof options.refetchInterval === 'number' ? options.refetchInterval : 0;

  const fetchReport = useCallback(async () => {
    if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const url = `${API_BASE_URL}/api/validation/${encodeURIComponent(jobId.trim())}`;
      const res = await apiFetch(url, { signal: controller.signal });

      if (!res.ok) {
        setError(`HTTP_${res.status}`);
        setData(null);
        setLoading(false);
        inFlightRef.current = false;
        return;
      }

      let json;
      try {
        json = await res.json();
      } catch (e) {
        setError('MALFORMED_RESPONSE');
        setData(null);
        setLoading(false);
        inFlightRef.current = false;
        return;
      }

      setData(json);
      setError(null);
      setLoading(false);
      inFlightRef.current = false;
    } catch (err) {
      inFlightRef.current = false;
      if (err && err.name === 'AbortError') {
        return;
      }
      setError('NETWORK_ERROR');
      setData(null);
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchReport();

    let timer = null;
    if (refetchInterval > 0 && jobId) {
      timer = setInterval(() => {
        fetchReport();
      }, refetchInterval);
    }

    return () => {
      if (timer) clearInterval(timer);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [jobId, fetchReport, refetchInterval]);

  return {
    data,
    loading,
    error,
    refetch: fetchReport,
  };
}
