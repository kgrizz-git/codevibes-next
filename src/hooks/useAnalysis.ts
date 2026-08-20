import { useState } from "react";
import { toast } from "sonner";
import type { Issue } from "@/components/IssueCard";
import { getStoredApiKey } from "@/components/SettingsModal";
import { useAnalysisStore } from "@/store/analysisStore";
import { withCsrfHeaders } from "@/lib/csrf";
import { API_BASE_URL } from "@/lib/api";

interface AnalysisResult {
  issues: Issue[];
  isClean: boolean;
}

export function useAnalysis() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const analyze = async (code: string): Promise<AnalysisResult | null> => {
    if (!code.trim()) {
      toast.error("Please paste some code to analyze");
      return null;
    }

    const apiKey = useAnalysisStore.getState().apiKey ?? (await getStoredApiKey());
    if (!apiKey) {
      toast.error("API key required", {
        description: "Please add your DeepSeek API key in Settings",
      });
      return null;
    }

    setIsLoading(true);
    setResult(null);

    try {
      // Use the new backend API for code analysis
      const response = await fetch(`${API_BASE_URL}/api/analyze`, await withCsrfHeaders(API_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          apiKey,
          repoUrl: 'code-snippet',
          priority: 1
        }),
      }));

      if (!response.ok) {
        const errorData = await response.json();
        toast.error("Analysis failed", {
          description: errorData.error || "Please try again",
        });
        return null;
      }

      // Parse SSE response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Failed to read response");
      }

      const decoder = new TextDecoder();
      const issues: Issue[] = [];
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (!data || data.startsWith(':')) continue;

            try {
              const event = JSON.parse(data);
              if (event.type === 'issue') {
                // Map to Issue interface from IssueCard
                issues.push({
                  id: event.data.id,
                  file: event.data.file || 'unknown',
                  line: event.data.line || 0,
                  severity: mapSeverity(event.data.severity),
                  message: event.data.description || event.data.title,
                  suggestedFix: event.data.fix || event.data.codeExample || 'Review and fix this code',
                });
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      const analysisResult: AnalysisResult = {
        issues,
        isClean: issues.length === 0,
      };

      setResult(analysisResult);

      if (analysisResult.isClean) {
        toast.success("Code looks clean!", {
          description: "No security issues detected",
        });
      } else {
        toast.warning(`Found ${issues.length} issue${issues.length !== 1 ? "s" : ""}`, {
          description: "Review the findings below",
        });
      }

      return analysisResult;
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("Something went wrong", {
        description: "Please try again later",
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const clearResult = () => {
    setResult(null);
  };

  return {
    analyze,
    isLoading,
    result,
    clearResult,
  };
}

// Map API severity to Issue severity
function mapSeverity(severity: string): Issue["severity"] {
  const lower = severity?.toLowerCase();
  if (lower === 'critical') return 'critical';
  if (lower === 'high') return 'high';
  if (lower === 'medium') return 'medium';
  return 'low';
}
