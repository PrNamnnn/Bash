import { buildSearchIndex } from "@/lib/content/search-index";

/** Static JSON search index, generated at build time from the course content. */
export function GET() {
  return Response.json(buildSearchIndex(), {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
