import { useEffect, useRef } from 'react';
import useGlobalStore from '../store/useGlobalStore';

/**
 * Hook to monitor component loading times of remote micro frontends
 * and report them to the global Zustand store.
 */
export function usePerformanceTrack(remoteName, componentName) {
  const startTimeRef = useRef(performance.now());
  const recordPerformanceMetric = useGlobalStore((state) => state.recordPerformanceMetric);

  useEffect(() => {
    const loadTime = performance.now() - startTimeRef.current;
    
    if (recordPerformanceMetric) {
      recordPerformanceMetric({
        remoteName,
        componentName,
        durationMs: Math.round(loadTime),
      });
    }

    console.log(`[MFE::PERF] Remote component '${remoteName}/${componentName}' loaded in ${loadTime.toFixed(2)}ms`);
  }, [remoteName, componentName, recordPerformanceMetric]);

  return {
    getDuration: () => performance.now() - startTimeRef.current,
  };
}

export default usePerformanceTrack;
