// src/lib/sanityImage.ts
// Browser-safe image URL builder. Only needs projectId/dataset, so it does not
// pull the Sanity client into the bundle like `urlFor` from `@/lib/sanity`.
import imageUrlBuilder from '@sanity/image-url';
import type { SanityImageSource } from '@sanity/image-url/lib/types/types';

const builder = imageUrlBuilder({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
});

export function urlFor(source: SanityImageSource) {
  return builder.image(source);
}
