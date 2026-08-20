export type GitHubRepository = { owner: string; name: string };

export function parseGitHubRepositoryUrl(url: string): GitHubRepository | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  return match ? { owner: match[1], name: match[2].replace(/\.git$/, '') } : null;
}
