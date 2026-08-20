import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Key, ExternalLink, CheckCircle2, XCircle, Loader2, Calculator, ArrowRight, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { useAnalysisStore } from '@/store/analysisStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function SetupPage() {
  const navigate = useNavigate();
  const { apiKey, apiKeyHydrated, setApiKey, repoUrl } = useAnalysisStore();
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (!apiKeyHydrated || !apiKey) {
      return;
    }
    setInputKey((current) => (current === '' ? apiKey : current));
  }, [apiKeyHydrated, apiKey]);

  const [fileCount, setFileCount] = useState(50);
  const avgTokensPerFile = 500;
  const costPer1kTokens = 0.001;
  const estimatedTokens = fileCount * avgTokensPerFile;
  const estimatedCost = (estimatedTokens / 1000) * costPer1kTokens;

  const handleSaveKey = async (): Promise<boolean> => {
    if (!inputKey.trim()) {
      toast.error('Please enter an API key');
      return false;
    }
    try {
      await setApiKey(inputKey.trim());
      toast.success('API key saved');
      return true;
    } catch {
      toast.error('Could not save API key in this browser');
      return false;
    }
  };

  const handleTestConnection = async () => {
    if (!inputKey.trim()) {
      toast.error('Please enter an API key first');
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus('idle');

    try {
      const response = await fetch('https://api.deepseek.com/v1/models', {
        headers: { Authorization: `Bearer ${inputKey}` },
      });

      if (response.ok) {
        setConnectionStatus('success');
        toast.success('Connection successful!');
      } else {
        setConnectionStatus('error');
        toast.error('Invalid API key');
      }
    } catch (error) {
      setConnectionStatus('error');
      toast.error('Connection failed');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleContinue = async () => {
    if (!inputKey.trim()) {
      toast.error('Please enter and save your API key first');
      return;
    }
    if (!(await handleSaveKey())) {
      return;
    }
    navigate(repoUrl ? '/analyze' : '/');
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-16">
        <div className="container mx-auto px-4 max-w-lg">
          <div className="animate-slide-up">
            {/* Header */}
            <div className="text-center mb-10">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-card border border-border mb-4">
                <Settings className="w-6 h-6 text-foreground" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Setup</h1>
              <p className="text-muted-foreground">
                Configure your DeepSeek API key to start analyzing
              </p>
            </div>

            {/* API Key Card */}
            <div className="p-6 rounded-xl border border-border bg-card mb-4">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <h2 className="font-semibold">DeepSeek API Key</h2>
              </div>

              <p className="text-sm text-muted-foreground mb-4">
                Your key is <strong>securely saved</strong> in your browser's local storage for future visits.
                No backend storage is used for keys.
              </p>

              <div className="space-y-4">
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={inputKey}
                    onChange={(e) => setInputKey(e.target.value)}
                    className="pr-10 font-mono text-sm bg-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-base"
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleSaveKey}
                    className="flex-1 bg-primary hover:bg-primary/90"
                    disabled={!inputKey.trim()}
                  >
                    Save Key
                  </Button>
                  {apiKey && (
                    <Button
                      variant="destructive"
                      onClick={async () => {
                        try {
                          await setApiKey(null);
                          setInputKey('');
                          setConnectionStatus('idle');
                          toast.success('API key deleted');
                        } catch {
                          toast.error('Could not delete the stored API key');
                        }
                      }}
                      className="px-4"
                    >
                      Delete
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={!inputKey.trim() || isTestingConnection}
                    className={cn(
                      'flex-1',
                      connectionStatus === 'success' && 'border-success text-success',
                      connectionStatus === 'error' && 'border-destructive text-destructive'
                    )}
                  >
                    {isTestingConnection ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testing</>
                    ) : connectionStatus === 'success' ? (
                      <><CheckCircle2 className="w-4 h-4 mr-2" />Connected</>
                    ) : connectionStatus === 'error' ? (
                      <><XCircle className="w-4 h-4 mr-2" />Failed</>
                    ) : (
                      'Test Connection'
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Get API Key Link */}
            <a
              href="https://platform.deepseek.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:border-primary/50 transition-base mb-4 group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                  <Key className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div>
                  <div className="font-medium">Get Free API Key</div>
                  <div className="text-sm text-muted-foreground">Sign up at platform.deepseek.com</div>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </a>

            {/* Cost Calculator */}
            <div className="p-6 rounded-xl border border-border bg-card mb-8">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-2 h-2 rounded-full bg-warning" />
                <h2 className="font-semibold">Cost Estimator</h2>
              </div>

              <p className="text-sm text-muted-foreground mb-4">
                Estimate your scan cost based on file count
              </p>

              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">
                    Number of files
                  </label>
                  <Input
                    type="number"
                    value={fileCount}
                    onChange={(e) => setFileCount(Math.max(1, parseInt(e.target.value) || 1))}
                    min={1}
                    max={10000}
                    className="bg-input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-muted">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Estimated Tokens</div>
                    <div className="font-mono font-semibold text-lg">{estimatedTokens.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Estimated Cost</div>
                    <div className="font-mono font-semibold text-lg text-success">${estimatedCost.toFixed(4)}</div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  * Based on ~500 tokens per file at $0.001/1K tokens
                </p>
              </div>
            </div>

            {/* Continue Button */}
            <Button
              onClick={handleContinue}
              className="w-full h-12 bg-primary hover:bg-primary/90 text-base font-medium"
              disabled={!inputKey.trim()}
            >
              Continue to Analysis
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
