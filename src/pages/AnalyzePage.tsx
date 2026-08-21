import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Github, Star, FileCode, Play, ArrowRight, Loader2, File, Menu, X, ChevronRight, Sun, Moon, Settings, BookOpen, Code2, History, PanelLeftClose, Home, PanelRight, Sparkles, Shield, Zap, Target, LogOut, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsModal } from '@/components/SettingsModal';
import { EffortSelector } from '@/components/EffortSelector';
import { VibeScoreGauge } from '@/components/ui/VibeScoreGauge';
import { PriorityBadge } from '@/components/ui/PriorityBadge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { IssueCard } from '@/components/ui/IssueCard';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { ActivityCards } from '@/components/ui/ActivityCards';
import { HistoryList } from '@/components/ui/HistoryList';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAnalysisStore, type AnalysisIssue, type RepoInfo } from '@/store/analysisStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import * as api from '@/lib/api';
import { readEffortPreference } from '@/lib/effortPreference';
import { calculateVibeScore, toStoreIssue } from '@/lib/analysisIssue';
import { parseGitHubRepositoryUrl } from '@/lib/githubUrl';
import { isEffortSelectorLocked, applyEffortChange } from '@/lib/effortSelection';
import { useEffortEstimate } from '@/hooks/useEffortEstimate';
import { useAuth } from '@/contexts/AuthContext';

async function validateAndEstimateRepo(
  owner: string,
  name: string,
  effort: api.EffortLevel,
  setStatusMessage: (message: string) => void,
  setRepoInfo: (info: RepoInfo) => void,
  loadEstimate: (repoUrl: string, selectedEffort: api.EffortLevel) => Promise<api.AnalysisEstimate | null>,
): Promise<RepoInfo | null> {
  try {
    setStatusMessage('Validating repository...');
    const result = await api.validateRepo(`https://github.com/${owner}/${name}`);
    if (!result.valid) {
      toast.error(result.error || 'Repository not found');
      return null;
    }

    const repoInfo = { owner, name, fullName: result.fullName, stars: result.stars, lastUpdate: result.lastUpdate, defaultBranch: result.defaultBranch };
    setRepoInfo(repoInfo);
    setStatusMessage('Estimating analysis...');
    return (await loadEstimate(`https://github.com/${owner}/${name}`, effort)) !== null ? repoInfo : null;
  } catch (error: unknown) {
    toast.error(error instanceof Error ? error.message : 'Failed to fetch repository info');
    return null;
  }
}

export default function AnalyzePage() {
  const navigate = useNavigate();
  const {
    apiKey, repoUrl, setRepoUrl, repoInfo, setRepoInfo, isAnalyzing, setIsAnalyzing,
    currentPriority, setCurrentPriority, priorities, updatePriority, vibeScore, setVibeScore,
    totalTokensUsed, setTotalTokensUsed, totalCost, setTotalCost, filesScanned, setFilesScanned, incrementFilesScanned, elapsedTime,
    incrementElapsedTime, setElapsedTime, awaitingApproval, setAwaitingApproval, resetAnalysis,
  } = useAnalysisStore();
  const { user, isAuthenticated, login, logout: handleLogout } = useAuth();

  const [inputUrl, setInputUrl] = useState(repoUrl || '');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [effort, setEffort] = useState<api.EffortLevel>(readEffortPreference);

  const [repoMode, setRepoMode] = useState<'url' | 'select'>('url');
  const [userRepos, setUserRepos] = useState<api.UserRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<api.UserRepo | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedTimeRef = useRef(0);
  const analysisRef = useRef<{ abort: () => void } | null>(null);
  const sessionEffortRef = useRef<api.EffortLevel>('standard');
  const sessionRepoInfoRef = useRef<RepoInfo | null>(null);
  const sessionTotalsRef = useRef({ tokensUsed: 0, cost: 0, filesScanned: 0 });
  const sessionIssuesRef = useRef<Record<1 | 2 | 3, AnalysisIssue[]>>({ 1: [], 2: [], 3: [] });
  const { invalidate: invalidateEstimate, load: loadEstimate, maxFilesPerPriority } = useEffortEstimate(updatePriority);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const shouldBeDark = stored !== 'light';
    setIsDark(shouldBeDark);
    document.documentElement.classList.toggle('dark', shouldBeDark);
  }, []);

  useEffect(() => {
    const pendingUrl = localStorage.getItem('pending_analysis_url');
    if (pendingUrl && isAuthenticated) {
      setInputUrl(pendingUrl);
      setRepoUrl(pendingUrl);
      localStorage.removeItem('pending_analysis_url');
      toast.success('Welcome back! Ready to analyze your repository.');
    }
  }, [isAuthenticated, setRepoUrl]);

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    localStorage.setItem('theme', newIsDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', newIsDark);
  };

  const handleStartAnalysis = async () => {
    if (!inputUrl.trim()) {
      toast.error('Please enter a repository URL');
      return;
    }
    const parsed = parseGitHubRepositoryUrl(inputUrl);
    if (!parsed) {
      toast.error('Invalid GitHub URL');
      return;
    }
    if (!apiKey) {
      toast.error('API key required');
      navigate('/setup');
      return;
    }

    if (!isAuthenticated) {
      localStorage.setItem('pending_analysis_url', inputUrl);
      setShowLoginDialog(true);
      return;
    }

    const selectedEffort = effort;
    setRepoUrl(inputUrl);
    resetAnalysis();
    setIsAnalyzing(true);
    sessionEffortRef.current = selectedEffort;
    sessionRepoInfoRef.current = null;
    sessionTotalsRef.current = { tokensUsed: 0, cost: 0, filesScanned: 0 };
    sessionIssuesRef.current = { 1: [], 2: [], 3: [] };
    setTotalCost(0);
    elapsedTimeRef.current = 0;
    invalidateEstimate();

    const validatedRepoInfo = await validateAndEstimateRepo(parsed.owner, parsed.name, sessionEffortRef.current, setStatusMessage, setRepoInfo, loadEstimate);
    if (!validatedRepoInfo) { setIsAnalyzing(false); setStatusMessage(''); return; }
    sessionRepoInfoRef.current = validatedRepoInfo;

    timerRef.current = setInterval(() => {
      elapsedTimeRef.current += 1;
      incrementElapsedTime();
    }, 1000);
    startPriorityScan(1);
  };

  const handleEffortChange = (nextEffort: api.EffortLevel) => {
    invalidateEstimate();
    applyEffortChange(nextEffort, inputUrl, setEffort, loadEstimate);
  };

  const handleLoginAndContinue = () => {
    setShowLoginDialog(false);
    login();
  };

  const startPriorityScan = async (level: 1 | 2 | 3) => {
    setIsAnalyzing(true);
    setCurrentPriority(level);
    updatePriority(level, { status: 'scanning', issues: [] });
    setStatusMessage(`Analyzing Priority ${level} files...`);

    const priorityIssues: AnalysisIssue[] = [];
    const fetchedPaths: string[] = [];
    let scanComplete = false;

    analysisRef.current = api.analyzeRepository(
      inputUrl,
      apiKey!,
      level,
      {
        onStatus: (data) => {
          setStatusMessage(data.message);
          if (data.filesScanned > 0) {
            setFilesScanned(sessionTotalsRef.current.filesScanned + data.filesScanned);
          }
          if (data.currentFile && !fetchedPaths.includes(data.currentFile)) {
            fetchedPaths.push(data.currentFile);
            updatePriority(level, { files: [...fetchedPaths] });
          }
        },
        onIssue: (issue) => {
          const storeIssue = toStoreIssue(issue);
          priorityIssues.push(storeIssue);
          updatePriority(level, { issues: [...priorityIssues] });
        },
        onComplete: (data) => {
          scanComplete = true;
          sessionTotalsRef.current.tokensUsed += data.tokensUsed;
          sessionTotalsRef.current.cost += data.cost;
          sessionTotalsRef.current.filesScanned += data.filesScanned;
          setFilesScanned(sessionTotalsRef.current.filesScanned);
          sessionIssuesRef.current[level] = priorityIssues;
          setTotalTokensUsed(sessionTotalsRef.current.tokensUsed);
          setTotalCost(sessionTotalsRef.current.cost);
          updatePriority(level, {
            status: 'complete',
            files: [...fetchedPaths],
            tokenCount: data.tokensUsed,
            issues: priorityIssues
          });

          const allIssues = priorities.flatMap((p) => p.issues).concat(priorityIssues);
          setVibeScore(calculateVibeScore(allIssues));

          if (level < 3) {
            setAwaitingApproval(level as 1 | 2);
            setIsAnalyzing(false);
            setCurrentPriority(null);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setStatusMessage(`Priority ${level} complete. ${priorityIssues.length} issues found.`);
          } else {
            completeAnalysis();
          }
        },
        onError: (error) => {
          console.error('Analysis error:', error);
          toast.error(error.message || 'Analysis failed');

          if (!scanComplete) {
            updatePriority(level, { status: 'pending' });
          }

          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          setIsAnalyzing(false);
          setCurrentPriority(null);
          setStatusMessage('');
        },
      },
      sessionEffortRef.current,
    );
  };

  const handleApproval = (approved: boolean) => {
    if (approved && awaitingApproval) {
      setAwaitingApproval(null);
      if (!timerRef.current) {
        timerRef.current = setInterval(() => {
          elapsedTimeRef.current += 1;
          incrementElapsedTime();
        }, 1000);
      }
      startPriorityScan((awaitingApproval + 1) as 2 | 3);
    } else {
      for (let i = (awaitingApproval || 0) + 1; i <= 3; i++) {
        updatePriority(i as 1 | 2 | 3, { status: 'skipped' });
      }
      setAwaitingApproval(null);
      completeAnalysis();
    }
  };

  const loadHistory = (entry: api.HistoryEntry) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    resetAnalysis();

    setInputUrl(entry.repo_url);
    setRepoUrl(entry.repo_url);

    const fullName = entry.repo_full_name || entry.repo_name;
    const ownerPart = fullName.includes('/') ? fullName.split('/')[0] : '';
    const loadedRepoInfo = {
      owner: ownerPart,
      name: entry.repo_name,
      fullName: fullName,
      stars: 0,
      lastUpdate: entry.created_at,
    };
    setRepoInfo(loadedRepoInfo);
    sessionRepoInfoRef.current = loadedRepoInfo;

    setVibeScore(entry.vibe_score);
    setTotalTokensUsed(entry.tokens_used);
    setTotalCost(entry.cost);

    const filesInIssues = new Set(entry.issues.map(i => i.file).filter(f => f && f !== 'unknown')).size;
    setFilesScanned(entry.files_scanned || filesInIssues || 0);
    setElapsedTime(entry.duration_ms ? Math.floor(entry.duration_ms / 1000) : 0);
    elapsedTimeRef.current = entry.duration_ms ? Math.floor(entry.duration_ms / 1000) : 0;

    const backendIssues = entry.issues || [];

    const p1 = backendIssues.filter(i => i.category === 'security' || (!i.category && (i.severity?.toUpperCase() === 'CRITICAL' || i.severity?.toUpperCase() === 'HIGH'))).map(toStoreIssue);
    const p2 = backendIssues.filter(i => i.category === 'bug' || i.category === 'performance').map(toStoreIssue);
    const p3 = backendIssues.filter(i => i.category === 'quality' || (!i.category && i.severity?.toUpperCase() === 'LOW')).map(toStoreIssue);

    const getUniqueFiles = (issues: AnalysisIssue[]) => Array.from(new Set(issues.filter(i => i.file).map(i => i.file!)));

    updatePriority(1, { status: 'complete', issues: p1, files: getUniqueFiles(p1) });
    updatePriority(2, { status: 'complete', issues: p2, files: getUniqueFiles(p2) });
    updatePriority(3, { status: 'complete', issues: p3, files: getUniqueFiles(p3) });

    setIsAnalyzing(false);
    setStatusMessage('Analysis loaded from history');
    setShowHistory(false);
    setSelectedRepo(null);
    setRepoMode('url');

    toast.success('Analysis loaded from history');
  };

  const completeAnalysis = async () => {
    setIsAnalyzing(false);
    setCurrentPriority(null);
    setStatusMessage('Analysis complete!');
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    toast.success('Analysis complete!');


    const sessionRepoInfo = sessionRepoInfoRef.current;
    if (isAuthenticated && sessionRepoInfo) {
      try {
        const allIssues = ([1, 2, 3] as const).flatMap((priority) => sessionIssuesRef.current[priority].map((issue) => ({
          ...issue, category: priority === 1 ? 'security' as const : priority === 2 ? 'bug' as const : 'quality' as const,
        })));
        const finalVibeScore = calculateVibeScore(allIssues);
        setVibeScore(finalVibeScore);

        await api.saveAnalysis({
          repoUrl: inputUrl,
          repoName: sessionRepoInfo.name,
          repoFullName: sessionRepoInfo.fullName,
          issuesCount: allIssues.length,
          vibeScore: finalVibeScore,
          tokensUsed: sessionTotalsRef.current.tokensUsed,
          cost: sessionTotalsRef.current.cost,
          filesScanned: sessionTotalsRef.current.filesScanned,
          durationMs: elapsedTimeRef.current * 1000,
          effort: sessionEffortRef.current,
          issues: allIssues.map(issue => ({
            id: issue.id,
            title: issue.title,
            description: issue.description,
            severity: issue.severity === 'critical' ? 'CRITICAL' as const : issue.severity === 'important' ? 'HIGH' as const : 'LOW' as const,
            file: issue.file || 'unknown',
            line: issue.line,
            codeExample: issue.codeExample,
            fix: issue.suggestion,
            category: issue.category,
          })),
        });
        toast.success('Analysis saved to history');
      } catch (err) {
        console.error('Failed to save to history:', err);
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getAllIssues = () => priorities.flatMap((p) => p.issues);
  const criticalIssues = getAllIssues().filter((i) => i.severity === 'critical');

  const importantIssues = getAllIssues().filter((i) => i.severity === 'important');
  const niceToHaveIssues = getAllIssues().filter((i) => i.severity === 'nice-to-have');

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (analysisRef.current) analysisRef.current.abort();
    };
  }, []);

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile Menu Toggle */}
      <button
        className="lg:hidden fixed bottom-6 left-6 z-50 p-4 rounded-full bg-primary text-primary-foreground shadow-glow"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle sidebar"
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Left Sidebar - Full height */}
      <aside className={cn(
        'fixed lg:sticky top-0 left-0 z-40 h-screen border-r border-border bg-sidebar transition-all duration-300 lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        sidebarCollapsed ? 'lg:w-0 lg:border-0 lg:overflow-hidden' : 'w-72'
      )}>
        <div className="h-full overflow-y-auto p-5 flex flex-col gap-6 w-72">
          {/* Top Actions - History Button Only */}
          <div className="flex items-center">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                "p-2 rounded-lg border transition-colors",
                showHistory
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              aria-label="History"
              title="Analysis History"
            >
              <History className="w-4 h-4" />
            </button>
          </div>

          {/* Logo */}
          <div className="flex items-center justify-center py-2">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="CodeVibes Logo" className="w-10 h-10 rounded-xl" />
              <div className="flex flex-col">
                <span className="font-bold text-lg tracking-tight leading-none">CodeVibes</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">v1.0.4-beta</span>
              </div>
            </div>
          </div>

          {/* Repo URL Input */}
          <div className="space-y-3">
            {/* Mode Toggle for authenticated users */}
            {isAuthenticated && (
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => {
                    setRepoMode('url');
                    setSelectedRepo(null);
                  }}
                  className={cn(
                    "flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-colors",
                    repoMode === 'url'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  Paste URL
                </button>
                <button
                  onClick={async () => {
                    setRepoPickerOpen(true);
                    if (userRepos.length === 0) {
                      setLoadingRepos(true);
                      const { repos } = await api.getUserRepos();
                      setUserRepos(repos);
                      setLoadingRepos(false);
                    }
                  }}
                  className={cn(
                    "flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-colors",
                    repoMode === 'select'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  Your Repos
                </button>
              </div>
            )}

            <label className="text-sm text-muted-foreground">Repository URL</label>

            {/* Show selected repo or URL input */}
            {selectedRepo ? (
              <div className="flex items-center gap-2 p-2 rounded-lg border border-primary bg-primary/5">
                <Github className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium flex-1 truncate">{selectedRepo.name}</span>
                {selectedRepo.isPrivate && <span className="text-xs">🔒</span>}
                <button
                  onClick={() => {
                    setSelectedRepo(null);
                    setInputUrl('');
                    setRepoMode('url');
                  }}
                  className="p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Input
                type="url"
                placeholder="https://github.com/owner/repo"
                value={inputUrl}
                onChange={(e) => {
                  invalidateEstimate();
                  setInputUrl(e.target.value);
                }}
                disabled={isAnalyzing}
                className="bg-input"
              />
            )}

            <EffortSelector
              value={effort}
              onChange={handleEffortChange}
              maxFilesPerPriority={maxFilesPerPriority}
              disabled={isEffortSelectorLocked(isAnalyzing, awaitingApproval)}
            />

            <Button
              onClick={handleStartAnalysis}
              className="w-full bg-primary hover:bg-primary/90"
              disabled={isAnalyzing || !inputUrl.trim()}
            >
              {isAnalyzing ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyzing...</>
              ) : (
                <><Play className="w-4 h-4 mr-2" />Start Analysis</>
              )}
            </Button>
          </div>

          {/* Repo Info */}
          {repoInfo && (
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="flex items-start gap-3">
                <Github className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate">{repoInfo.name}</h3>
                  <p className="text-xs text-muted-foreground truncate">{repoInfo.fullName}</p>
                  {repoInfo.stars !== undefined && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                      <Star className="w-3 h-3" />
                      {repoInfo.stars.toLocaleString()} stars
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Priority Status */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Priority Levels</h4>
            {priorities.map((priority) => (
              <div key={priority.level} className={cn(
                'p-4 rounded-xl border transition-all',
                priority.status === 'scanning' && 'border-primary bg-primary/5',
                priority.status === 'complete' && 'border-success/50 bg-success/5',
                priority.status === 'skipped' && 'border-border bg-muted/50 opacity-50',
                priority.status === 'pending' && 'border-border bg-card'
              )}>
                <div className="flex items-center justify-between mb-2">
                  <PriorityBadge level={priority.level} size="sm" />
                  <span className="text-xs text-muted-foreground">{priority.files.length} files</span>
                </div>
                <p className="text-xs text-muted-foreground">{priority.description}</p>
                {priority.status === 'scanning' && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse-dot" />
                    <span className="text-xs text-primary">Scanning...</span>
                  </div>
                )}
                {priority.status === 'complete' && (
                  <p className="text-xs text-success mt-2 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    {priority.issues.length} issues found
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* File Tree */}
          {repoInfo && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Files</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {priorities.flatMap((p) =>
                  p.files.filter(f => !f.startsWith('security-file-') && !f.startsWith('core-file-') && !f.startsWith('support-file-')).map((file) => (
                    <div key={file} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded-lg hover:bg-muted transition-base">
                      <File className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="truncate flex-1 font-mono">{file}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Token Counter */}
          {(isAnalyzing || totalTokensUsed > 0) && (
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="text-xs text-muted-foreground mb-1">Tokens Used</div>
              <div className="font-mono font-semibold text-lg">{totalTokensUsed.toLocaleString()}</div>
            </div>
          )}

          {/* History Panel */}
          {showHistory && (
            <div className="p-4 rounded-xl border border-border bg-card animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Analysis</h4>
              </div>
              <div className="space-y-2">
                {/* Show history from API for authenticated users */}
                {isAuthenticated ? (
                  <HistoryList onSelect={loadHistory} />
                ) : (
                  <p className="text-xs text-muted-foreground py-2">Login to save analysis history</p>
                )}
              </div>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* User Profile / Login */}
          <div className="pt-4 border-t border-border">
            {isAuthenticated ? (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
                <img
                  src={user?.avatar_url || 'https://github.com/identicons/default.png'}
                  alt="Avatar"
                  className="w-10 h-10 rounded-full"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user?.username}</p>
                  <p className="text-xs text-muted-foreground">Connected via GitHub</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={login}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors"
              >
                <Github className="w-5 h-5" />
                <span className="text-sm font-medium">Login with GitHub</span>
              </button>
            )}
          </div>

          {/* Navigation Links */}
          <div className="pt-4 border-t border-border space-y-2">
            <Link
              to="/documentation"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <BookOpen className="w-4 h-4" />
              Documentation
            </Link>
            <Link
              to="/api-reference"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Code2 className="w-4 h-4" />
              API Reference
            </Link>
            <Link
              to="/"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Home className="w-4 h-4" />
              Back to Home
            </Link>
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
          </div>

          {/* Theme Toggle */}
          <div className="pt-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Theme</span>
            <button
              onClick={toggleTheme}
              className="flex items-center gap-1 p-1 rounded-full bg-muted/50 border border-border/50"
              aria-label="Toggle theme"
            >
              <span className={cn(
                "p-1.5 rounded-full transition-colors",
                !isDark ? "bg-foreground text-background" : "text-muted-foreground"
              )}>
                <Sun className="w-3.5 h-3.5" />
              </span>
              <span className={cn(
                "p-1.5 rounded-full transition-colors",
                isDark ? "bg-foreground text-background" : "text-muted-foreground"
              )}>
                <Moon className="w-3.5 h-3.5" />
              </span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-5 lg:p-8 overflow-x-hidden" >
        {/* Top Bar - Sidebar Toggle on LEFT, Back to Home on RIGHT */}
        <div className="flex items-center justify-between mb-6" >
          {/* Left: Sidebar Toggle (only when collapsed) */}
          <div className="flex items-center gap-3" >
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="hidden lg:flex items-center gap-2 p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Open sidebar"
                title="Open Sidebar"
              >
                <Menu className="w-4 h-4" />
              </button>
            )
            }
            {
              !sidebarCollapsed && (
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className="hidden lg:flex items-center gap-2 p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Close sidebar"
                  title="Close Sidebar"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              )
            }
          </div>

          {/* Right: Toggle Right Stats Panel (Mobile/Tablet) */}
          <button
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
            className="xl:hidden flex items-center gap-2 p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Toggle analysis stats"
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>

        {
          !repoInfo && !isAnalyzing ? (
            <div className="flex flex-col items-center justify-center min-h-[70vh] text-center animate-fade-in px-4">
              {/* Icon */}
              <div className="relative mb-8">
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
                  <FileCode className="w-12 h-12 text-primary" />
                </div>
                <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-primary-foreground" />
                </div>
              </div>

              {/* Main Heading */}
              <h2 className="text-3xl font-bold tracking-tight mb-3">Ready to Analyze</h2>
              <p className="text-muted-foreground mb-8 max-w-md text-lg">
                Enter a GitHub repository URL in the sidebar to start your AI-powered code analysis.
              </p>

              {/* Feature Highlights */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full mb-8">
                <div className="p-4 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center mb-3 mx-auto">
                    <Shield className="w-5 h-5 text-red-400" />
                  </div>
                  <h4 className="font-semibold text-sm mb-1">Security First</h4>
                  <p className="text-xs text-muted-foreground">Find vulnerabilities, secrets & misconfigurations</p>
                </div>
                <div className="p-4 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center mb-3 mx-auto">
                    <Zap className="w-5 h-5 text-yellow-400" />
                  </div>
                  <h4 className="font-semibold text-sm mb-1">Priority Scanning</h4>
                  <p className="text-xs text-muted-foreground">Analyze critical files first, save tokens</p>
                </div>
                <div className="p-4 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center mb-3 mx-auto">
                    <Target className="w-5 h-5 text-green-400" />
                  </div>
                  <h4 className="font-semibold text-sm mb-1">Actionable Fixes</h4>
                  <p className="text-xs text-muted-foreground">Get code examples for every issue</p>
                </div>
              </div>

              {/* CTA Button */}
              <Button
                size="lg"
                onClick={() => {
                  setSidebarCollapsed(false);
                  setTimeout(() => document.querySelector('input')?.focus(), 100);
                }}
                className="bg-primary hover:bg-primary/90"
              >
                <Play className="w-4 h-4 mr-2" />
                Get Started
              </Button>

              {/* Subtle hint */}
              <p className="text-xs text-muted-foreground mt-6 flex items-center gap-1">
                <span>Powered by</span>
                <span className="font-semibold text-foreground">DeepSeek Reasoner</span>
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
              {/* Status Header */}
              <div className="p-5 rounded-xl border border-border bg-card">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {isAnalyzing && <span className="w-2 h-2 rounded-full bg-primary animate-pulse-dot" />}
                      <h1 className="font-bold text-lg">
                        {isAnalyzing ? 'Analyzing...' : awaitingApproval ? 'Approval Required' : 'Analysis Complete'}
                      </h1>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {statusMessage || (currentPriority ? `Scanning Priority ${currentPriority}` : awaitingApproval ? `Priority ${awaitingApproval} complete. Continue?` : 'All priorities processed')}
                    </p>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="font-mono font-semibold text-lg">{formatTime(elapsedTime)}</div>
                      <div className="text-xs text-muted-foreground">Time</div>
                    </div>
                    <div className="text-center">
                      <div className="font-mono font-semibold text-lg">{filesScanned}</div>
                      <div className="text-xs text-muted-foreground">Files</div>
                    </div>
                    <div className="text-center">
                      <div className="font-mono font-semibold text-lg">{totalTokensUsed.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Tokens</div>
                    </div>
                  </div>
                </div>
                {isAnalyzing && <ProgressBar value={filesScanned} max={priorities.reduce((acc, p) => acc + p.files.length, 0) || 10} showLabel label="Progress" />}
              </div>

              {/* Approval Gate */}
              {awaitingApproval && (
                <div className="p-6 rounded-xl border-2 border-primary bg-primary/5 animate-slide-up">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-foreground font-bold">{awaitingApproval}</span>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-lg mb-1">Priority {awaitingApproval} Complete</h3>
                      <p className="text-muted-foreground mb-4">
                        Found {priorities.find((p) => p.level === awaitingApproval)?.issues.length || 0} issues.
                        Continue to Priority {awaitingApproval + 1}?
                      </p>
                      <div className="flex gap-3">
                        <Button onClick={() => handleApproval(true)} className="bg-primary hover:bg-primary/90">
                          Continue to P{awaitingApproval + 1}
                          <ChevronRight className="ml-2 w-4 h-4" />
                        </Button>
                        <Button variant="outline" onClick={() => handleApproval(false)}>
                          Stop Here
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Results */}
              {getAllIssues().length > 0 && (
                <div className="space-y-6">
                  {criticalIssues.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary" />
                        Critical Issues ({criticalIssues.length})
                      </h3>
                      {criticalIssues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
                    </div>
                  )}
                  {importantIssues.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-warning" />
                        Important ({importantIssues.length})
                      </h3>
                      {importantIssues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
                    </div>
                  )}
                  {niceToHaveIssues.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                        Nice-to-haves ({niceToHaveIssues.length})
                      </h3>
                      {niceToHaveIssues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
                    </div>
                  )}

                  {!isAnalyzing && !awaitingApproval && (
                    <div className="flex justify-center pt-6">
                      <Button onClick={() => navigate('/results')} className="bg-primary hover:bg-primary/90">
                        View Full Report
                        <ArrowRight className="ml-2 w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {isAnalyzing && getAllIssues().length === 0 && (
                <div className="space-y-6">
                  {/* Activity Cards - Show agent actions in main area */}
                  <div className="p-5 rounded-xl border border-border bg-card">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Agent Activity</h3>
                    <ActivityCards
                      currentPhase={
                        statusMessage.includes('Validating') ? 'validating' :
                          statusMessage.includes('Fetching') || statusMessage.includes('Estimating') ? 'fetching' :
                            'analyzing'
                      }
                      currentFile={statusMessage.includes('Analyzing:') ? statusMessage.replace('Analyzing: ', '') : undefined}
                      priority={currentPriority || 1}
                      filesScanned={filesScanned}
                      totalFiles={priorities[currentPriority ? currentPriority - 1 : 0]?.files?.length || 0}
                    />
                  </div>
                  <SkeletonLoader variant="card" />
                </div>
              )}
            </div>
          )
        }
      </main >

      {/* Right Panel */}
      {
        repoInfo && (
          <>
            {/* Mobile Overlay */}
            {rightSidebarOpen && (
              <div
                className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm xl:hidden"
                onClick={() => setRightSidebarOpen(false)}
              />
            )}

            <aside className={cn(
              "fixed inset-y-0 right-0 z-50 w-80 border-l border-border bg-background p-5 space-y-6 overflow-y-auto transition-transform duration-300 xl:translate-x-0 xl:w-72 xl:h-screen xl:sticky xl:top-0",
              rightSidebarOpen ? "translate-x-0 shadow-2xl" : "translate-x-full xl:translate-x-0"
            )}>
              {/* Mobile Close Button */}
              <div className="xl:hidden flex justify-end mb-4">
                <button
                  onClick={() => setRightSidebarOpen(false)}
                  className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex flex-col items-center py-4">
                <VibeScoreGauge score={vibeScore} size="md" />
              </div>

              {/* Activity Cards - Show during analysis */}
              {isAnalyzing && (
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Activity</h4>
                  <ActivityCards
                    currentPhase={
                      statusMessage.includes('Validating') ? 'validating' :
                        statusMessage.includes('Fetching') || statusMessage.includes('Estimating') ? 'fetching' :
                          'analyzing'
                    }
                    currentFile={statusMessage.includes('Analyzing:') ? statusMessage.replace('Analyzing: ', '') : undefined}
                    priority={currentPriority}
                    filesScanned={filesScanned}
                    totalFiles={priorities[currentPriority - 1]?.files?.length || 0}
                  />
                </div>
              )}

              <div className="space-y-4">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Live Stats</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg border border-border bg-card text-center">
                    <div className="font-mono font-semibold">{filesScanned}</div>
                    <div className="text-xs text-muted-foreground">Files</div>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-card text-center">
                    <div className="font-mono font-semibold">{getAllIssues().length}</div>
                    <div className="text-xs text-muted-foreground">Issues</div>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-card text-center">
                    <div className="font-mono font-semibold">{formatTime(elapsedTime)}</div>
                    <div className="text-xs text-muted-foreground">Time</div>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-card text-center">
                    <div className="font-mono font-semibold text-success">${totalCost.toFixed(4)}</div>
                    <div className="text-xs text-muted-foreground">Cost</div>
                  </div>
                </div>
              </div>
            </aside>
          </>
        )
      }

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* Repo Picker Modal */}
      {
        repoPickerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              onClick={() => setRepoPickerOpen(false)}
            />

            {/* Modal */}
            <div className="relative w-full max-w-lg mx-4 bg-card border border-border rounded-2xl shadow-2xl p-6 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Select Repository</h2>
                <button
                  onClick={() => setRepoPickerOpen(false)}
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {loadingRepos ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="ml-2 text-muted-foreground">Loading your repositories...</span>
                </div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto space-y-2">
                  {userRepos.map(repo => (
                    <button
                      key={repo.id}
                      onClick={() => {
                        setSelectedRepo(repo);
                        setInputUrl(repo.url);
                        setRepoMode('select');
                        setRepoPickerOpen(false);
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted hover:border-primary/50 transition-colors text-left"
                    >
                      <Github className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{repo.name}</span>
                          {repo.isPrivate && <span className="text-xs text-yellow-500">🔒</span>}
                        </div>
                        {repo.description && (
                          <p className="text-xs text-muted-foreground truncate">{repo.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Star className="w-3 h-3" />
                        {repo.stars}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      }

      {/* Login Required Dialog */}
      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="w-5 h-5" />
              Login Required
            </DialogTitle>
            <DialogDescription>
              Sign in with GitHub to save your analysis history and access advanced features.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm text-muted-foreground">
              Your repository URL has been saved. After logging in, you'll continue your analysis.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowLoginDialog(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-[#24292e] hover:bg-[#24292e]/90"
                onClick={handleLoginAndContinue}
              >
                <Github className="mr-2 w-4 h-4" />
                Login with GitHub
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
