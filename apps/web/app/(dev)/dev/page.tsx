import { notFound } from "next/navigation";
import { DevGallery } from "./gallery";

/**
 * Review page for the base components (M0-FE-02). Development and preview builds only: a production
 * build answers 404. The sample text lives in `gallery.tsx`; it is not product copy.
 */
export default function DevPage() {
  if (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production") notFound();
  return <DevGallery />;
}
