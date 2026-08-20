import { cn } from '@/lib/utils';
import type { EffortLevel } from '@/lib/api';

const options: Array<{ value: EffortLevel; title: string; description: string }> = [
  { value: 'quick', title: 'Quick', description: 'Up to 5 files per priority' },
  { value: 'standard', title: 'Standard', description: 'Up to 20 files per priority' },
  { value: 'thorough', title: 'Thorough', description: 'Up to 40 files per priority' },
];

interface EffortSelectorProps {
  value: EffortLevel;
  onChange: (value: EffortLevel) => void;
  disabled?: boolean;
}

export function EffortSelector({ value, onChange, disabled = false }: EffortSelectorProps) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm text-muted-foreground">Review effort</legend>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-2 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              value === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            aria-pressed={value === option.value}
          >
            <span className="block text-xs font-medium">{option.title}</span>
            <span className="block text-[10px] leading-tight opacity-80">{option.description}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
