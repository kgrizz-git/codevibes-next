export type GitHubRepository = { owner: string; name: string };

export function parseGitHubRepositoryUrl(url: string): GitHubRepository | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.host !== 'github.com' || parsed.username || parsed.password) {
      return null;
    }

    const parts = parsed.pathname.replace(/\/$/, '').split('/');
    if (parts.length !== 3 || !parts[1] || !parts[2] || !/^[\w.-]+$/.test(parts[1]) || !/^[\w.-]+$/.test(parts[2].replace(/\.git$/, ''))) {
      return null;
    }

    const owner = parts[1];
    const repository = parts[2];
    const name = repository.replace(/\.git$/, '');
    return owner && name ? { owner, name } : null;
  } catch {
    return null;
  }
}
