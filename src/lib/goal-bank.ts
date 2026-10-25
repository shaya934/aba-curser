import entries from '../../data/goal-bank.json';
export type GoalTemplate = (typeof entries)[number];
export const goalBank = entries;
export function searchGoalBank(input: {
  q?: string;
  domain?: string;
  level?: string;
  page?: number;
}) {
  const q = (input.q || '').trim().toLowerCase();
  const page = Math.max(1, Math.floor(input.page || 1));
  const matches = entries.filter(
    (e) =>
      (!input.domain || e.domain === input.domain) &&
      (!input.level || e.level === input.level) &&
      (!q || Object.values(e).join(' ').toLowerCase().includes(q)),
  );
  const totalPages = Math.max(1, Math.ceil(matches.length / 20));
  const current = Math.min(page, totalPages);
  return {
    items: matches.slice((current - 1) * 20, current * 20),
    total: matches.length,
    page: current,
    totalPages,
    domains: [...new Set(entries.map((e) => e.domain))].sort(),
    levels: [...new Set(entries.map((e) => e.level))],
  };
}
