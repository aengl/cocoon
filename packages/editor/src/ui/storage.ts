interface RecentlyOpened {
  [path: string]: number;
}

export function getRecentlyOpened(maxItems = 8): RecentlyOpened {
  const recent = JSON.parse(
    window.localStorage.getItem('recentlyOpened') || '{}'
  );
  const recentList = Object.keys(recent).map(key => ({
    date: recent[key],
    path: key,
  }));
  const filteredRecentList =
    recentList.length > 0 ? recentList.sort((a, b) => b.date - a.date) : [];
  return filteredRecentList.slice(0, maxItems).reduce((acc, x) => {
    acc[x.path] = x.date;
    return acc;
  }, {});
}

export function getLastOpened(): string | null {
  const recent = getRecentlyOpened();
  const recentPaths = Object.keys(recent);
  return recentPaths.length > 0
    ? recentPaths.sort((a, b) => recent[b] - recent[a])[0]
    : null;
}

export function updateRecentlyOpened(cocoonFilePath: string): RecentlyOpened {
  const recent = getRecentlyOpened();
  recent[cocoonFilePath] = Date.now();
  window.localStorage.setItem('recentlyOpened', JSON.stringify(recent));
  return recent;
}
