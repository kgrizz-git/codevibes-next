// ============================================================
// HistoryList - Fetches and displays analysis history from API
// ============================================================

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import * as api from '@/lib/api';

interface HistoryListProps {
    onSelect: (entry: api.HistoryEntry) => void;
}

export function HistoryList({ onSelect }: HistoryListProps) {
    const [history, setHistory] = useState<api.HistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const { analyses } = await api.getHistory(5);
                setHistory(analyses);
            } catch (err) {
                console.error('Failed to fetch history:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (history.length === 0) {
        return <p className="text-xs text-muted-foreground py-2">No recent analysis</p>;
    }

    const handleClick = (entry: api.HistoryEntry) => {
        console.log('History: Selecting entry:', entry.id);
        onSelect(entry);
    };

    return (
        <>
            {history.map((entry) => (
                <button
                    key={entry.id}
                    onClick={() => handleClick(entry)}
                    className="w-full text-left p-2 rounded-lg hover:bg-muted transition-colors"
                >
                    <div className="text-sm font-medium truncate">{entry.repo_name}</div>
                    <div className="text-xs text-muted-foreground">
                        {entry.issues_count} issues • Score: {entry.vibe_score} • {entry.effort ?? 'Legacy'} effort
                    </div>
                </button>
            ))}
        </>
    );
}
