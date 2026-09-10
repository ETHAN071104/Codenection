export function extractStayQuery(request: string) {
  const cleaned = request.trim().replace(/\s+/g, ' ');
  const patterns = [
    /^(?:i(?:['’]m| am)|we(?:['’]re| are))\s+staying\s+(?:at|in)\s+(.+)$/i,
    /^(?:our|my)\s+(?:hotel|accommodation|stay)\s+is\s+(.+)$/i,
    /^(?:we|i)\s+(?:have\s+)?booked\s+(.+)$/i,
    /^(?:please\s+)?(?:change|switch|update|set)\s+(?:(?:our|my|the)\s+)?(?:stay|hotel|accommodation)\s+to\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const query = match?.[1]
      ?.trim()
      .replace(/^["'“”‘’]+|["'“”‘’.,!?]+$/g, '')
      .trim();
    if (query && query.length <= 160) return query;
  }
  return null;
}
