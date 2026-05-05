// Levenshtein distance between two strings (lowercase, trimmed).
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  )
}

// Jaccard similarity on token sets.
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  const intersection = [...a].filter((x) => b.has(x)).length
  const union = new Set([...a, ...b]).size
  return intersection / union
}

// Normalized Levenshtein similarity (0..1, 1 = identical).
function levSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

export interface MatchScore {
  skuExact: boolean
  skuPartial: boolean
  nameSimilarity: number   // 0..1
  jaccardSimilarity: number // 0..1
  score: number            // 0..100 combined
  confidence: 'high' | 'medium' | 'low'
}

export function computeMatchScore(
  masterName: string,
  masterSku: string,
  marketName: string,
  marketSku: string,
): MatchScore {
  const normMasterSku = masterSku.trim().toLowerCase()
  const normMarketSku = marketSku.trim().toLowerCase()

  const skuExact = normMasterSku === normMarketSku
  const skuPartial = !skuExact && (normMasterSku.includes(normMarketSku) || normMarketSku.includes(normMasterSku))

  const nameSim = levSimilarity(masterName.toLowerCase(), marketName.toLowerCase())
  const jaccSim = jaccard(tokenize(masterName), tokenize(marketName))

  let score = 0
  if (skuExact)   score += 60
  else if (skuPartial) score += 30

  score += nameSim * 25
  score += jaccSim * 15

  score = Math.min(100, Math.round(score))

  const confidence: 'high' | 'medium' | 'low' =
    score >= 85 ? 'high' : score >= 55 ? 'medium' : 'low'

  return { skuExact, skuPartial, nameSimilarity: nameSim, jaccardSimilarity: jaccSim, score, confidence }
}
