import { cachedLookup } from '@/lib/lookupCache';
import { NextResponse } from 'next/server';
import { client } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { getUserSiteInfo, buildSiteFilter } from '@/lib/siteFiltering';

export async function GET() {
  try {
    const userSiteInfo = await getUserSiteInfo();
    const siteFilter = buildSiteFilter(userSiteInfo);

    const query = groq`
        *[_type == "Site" ${siteFilter}] | order(name asc) {
          _id,
          name,
          location,
          manager->{
            name
          },
          "bins": *[_type == "Bin" && site._ref == ^._id] | order(name asc) {
            _id,
            name,
            binType,
            locationDescription
          }
        }
      `;

    try {
      const locations = await cachedLookup('locations', [siteFilter], () => client.fetch(query), 60);
      return NextResponse.json(locations);
    } catch (error) {
      console.error('Failed to fetch locations and bins:', error);
      return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
  } catch (error) {
    console.error('Failed to fetch locations:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}