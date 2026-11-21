import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { slugSchema } from "@innovate/shared";
import { PortfolioView } from "@/components/present/PortfolioView";
import { loadPortfolio } from "@/lib/present";

async function load(slug: string) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const data = await loadPortfolio({ slug: parsed.data });
  return data?.portfolio.published ? data : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = await load((await params).slug);
  if (!data) return { title: "Not found" };
  return { title: { absolute: data.portfolio.title || "Portfolio" }, description: data.portfolio.bio.slice(0, 160) || undefined };
}

/** Public portfolio page: no login. Unpublished (or unknown) addresses are a plain 404. */
export default async function PublicPortfolio({ params }: { params: Promise<{ slug: string }> }) {
  const data = await load((await params).slug);
  if (!data) notFound();
  return <PortfolioView data={data} />;
}
