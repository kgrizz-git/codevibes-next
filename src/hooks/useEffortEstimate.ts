import { useRef } from 'react';
import * as api from '@/lib/api';

type UpdatePriority = (level: 1 | 2 | 3, updates: { files: string[]; status: 'pending' }) => void;

function placeholderFiles(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-file-${index + 1}`);
}

export function useEffortEstimate(updatePriority: UpdatePriority) {
  const requestRef = useRef(0);

  const invalidate = () => { requestRef.current += 1; };
  const load = async (repoUrl: string, effort: api.EffortLevel): Promise<api.AnalysisEstimate | null> => {
    const requestId = ++requestRef.current;
    let estimate: api.AnalysisEstimate;
    try {
      estimate = await api.getEstimate(repoUrl, effort);
    } catch (error) {
      if (requestId !== requestRef.current) return null;
      throw error;
    }
    if (requestId !== requestRef.current) return null;

    updatePriority(1, { files: placeholderFiles('security', estimate.priority1.files), status: 'pending' });
    updatePriority(2, { files: placeholderFiles('core', estimate.priority2.files), status: 'pending' });
    updatePriority(3, { files: placeholderFiles('support', estimate.priority3.files), status: 'pending' });
    return estimate;
  };

  return { invalidate, load };
}
