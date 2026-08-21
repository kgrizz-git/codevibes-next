import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { analysisStoreTestHooks, useAnalysisStore } from '@/store/analysisStore';
import ResultsPage from '@/pages/ResultsPage';

const storeHooks = analysisStoreTestHooks!;

beforeEach(() => {
  storeHooks.resetApiKeyWriteStateForTests();
  act(() => {
    useAnalysisStore.getState().resetAnalysis();
    // Seed enough state so ResultsPage renders the populated report view
    // (not the "No Results Yet" empty state).
    useAnalysisStore.getState().setRepoInfo({
      owner: 'acme',
      name: 'demo',
      fullName: 'acme/demo',
    });
  });
});

afterEach(() => {
  cleanup();
  storeHooks.resetApiKeyWriteStateForTests();
});

// The Cost stat card must render the server-accumulated cost from the store
// (`totalCost`), NOT an inline token-derived estimate. This contract test
// pins that behavior on the real component render.
function renderResultsWithCost(cost: number, tokens: number) {
  act(() => {
    useAnalysisStore.getState().setTotalCost(cost);
    // Tokens intentionally set to a value that would produce a DIFFERENT
    // legacy figure, proving the page no longer relies on it.
    useAnalysisStore.getState().setTotalTokensUsed(tokens);
  });

  render(
    <MemoryRouter>
      <ResultsPage />
    </MemoryRouter>,
  );
}

describe('ResultsPage cost contract', () => {
  it('renders the stored totalCost, not a hardcoded token estimate', () => {
    const samples = [0.0042, 0.1375, 1.5009];

    for (const cost of samples) {
      renderResultsWithCost(cost, Math.round(cost * 1234567));

      // The page must display the formatted store cost, not the token formula.
      expect(screen.getByText(`$${cost.toFixed(4)}`)).toBeTruthy();
      expect(screen.getByText('Cost')).toBeTruthy();

      // The displayed value must not equal the legacy (tokens/1e6)*0.14 output.
      const legacy = `$${((useAnalysisStore.getState().totalTokensUsed / 1000000) * 0.14).toFixed(4)}`;
      expect(screen.queryByText(legacy)).toBeNull();

      cleanup();
    }
  });

  it('resets the cost shown on a fresh analysis', () => {
    renderResultsWithCost(0.99, 1000000);
    expect(screen.getByText('$0.9900')).toBeTruthy();
    expect(useAnalysisStore.getState().totalCost).toBe(0.99);

    act(() => {
      useAnalysisStore.getState().resetAnalysis();
      // resetAnalysis also clears repoInfo (which gates the empty state), so
      // re-seed it to keep the report view mounted and verify the subscribed
      // component reflects the zeroed store cost.
      useAnalysisStore.getState().setRepoInfo({
        owner: 'acme',
        name: 'demo',
        fullName: 'acme/demo',
      });
    });

    expect(useAnalysisStore.getState().totalCost).toBe(0);
    expect(screen.getByText('$0.0000')).toBeTruthy();
  });
});
