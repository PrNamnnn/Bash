export const OPEN_SEARCH_EVENT = "bash-mastery:open-search";

export function openSearch(query?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: { query } }));
}
