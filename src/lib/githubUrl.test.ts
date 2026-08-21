import { describe, expect, it } from 'vitest';

import { parseGitHubRepositoryUrl } from './githubUrl';

describe('parseGitHubRepositoryUrl', () => {
  it('parses an HTTPS repository URL', () => {
    expect(parseGitHubRepositoryUrl('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', name: 'repo' });
  });

  it.each([
    'http://github.com/owner/repo',
    'https://github.com.evil.example/owner/repo',
    'https://github.com/owner/repo/issues',
    'https://user@github.com/owner/repo',
  ])('rejects non-repository URLs: %s', (url) => {
    expect(parseGitHubRepositoryUrl(url)).toBeNull();
  });
});
