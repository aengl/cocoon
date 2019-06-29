interface RecentlyOpened {
  [path: string]: number;
}

export function getRecentlyOpened(): RecentlyOpened {
  return JSON.parse(window.localStorage.getItem('recentlyOpened') || '{}');
}

export function getLastOpened(): string | null {
  const recent = getRecentlyOpened();
  const recentPaths = Object.keys(recent);
  return recentPaths.length > 0
    ? recentPaths.sort((a, b) => recent[b] - recent[a])[0]
    : null;
}

export function updateRecentlyOpened(definitionsPath: string): RecentlyOpened {
  const recent = getRecentlyOpened();
  recent[definitionsPath] = Date.now();
  window.localStorage.setItem('recentlyOpened', JSON.stringify(recent));
  return recent;
}
