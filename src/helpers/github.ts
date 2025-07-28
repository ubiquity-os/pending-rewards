interface GitHubUser {
  login: string;
  id: number;
  name?: string;
}

const userCache = new Map<number, string>();

export async function fetchGitHubUsername(userId: number): Promise<string> {
  if (userCache.has(userId)) {
    return userCache.get(userId)!;
  }

  try {
    const response = await fetch(`https://api.github.com/user/${userId}`, {
      headers: {
        "User-Agent": "nonce-checker",
        ...(process.env.GITHUB_TOKEN && {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        }),
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch GitHub user ${userId}: ${response.status}`);
      return `user-${userId}`;
    }

    const user: GitHubUser = await response.json();
    const username = user.login;

    userCache.set(userId, username);
    return username;
  } catch (error) {
    console.warn(`Error fetching GitHub user ${userId}:`, error);
    return `user-${userId}`;
  }
}

export async function fetchGitHubUsernames(
  userIds: number[]
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  const uncachedIds = userIds.filter((id) => !userCache.has(id));

  if (uncachedIds.length === 0) {
    for (const id of userIds) {
      results.set(id, userCache.get(id)!);
    }
    return results;
  }

  const batchSize = 10;
  for (let i = 0; i < uncachedIds.length; i += batchSize) {
    const batch = uncachedIds.slice(i, i + batchSize);

    const batchPromises = batch.map(async (userId) => {
      const username = await fetchGitHubUsername(userId);
      return { userId, username };
    });

    const batchResults = await Promise.all(batchPromises);

    for (const { userId, username } of batchResults) {
      results.set(userId, username);
    }

    if (i + batchSize < uncachedIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  for (const id of userIds) {
    if (!results.has(id) && userCache.has(id)) {
      results.set(id, userCache.get(id)!);
    }
  }

  return results;
}
