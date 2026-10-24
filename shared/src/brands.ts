import type { BrandId } from './types';

/** Brand kit: the creator's own pages, as shown on their Instagram profiles. */
export interface Brand {
  id: BrandId;
  name: string;
  handle: string;
  posts: string;
  followers: string;
  following: string;
  verified: boolean;
  bio: string[];
  avatar: { bg: string; ink: string; accent?: string; mark: 'tgf' | 'arrow' | 'word' | 'logo' | 'initial'; text?: string };
}

export const BRANDS: Record<BrandId, Brand> = {
  tgf: { id: 'tgf', name: 'TGF | The Growth Fever', handle: 'thegrowthfever', posts: '121', followers: '52.8K', following: '0', verified: true, bio: ['Business stories that teach.', 'Startup case studies that matter.'], avatar: { bg: '#223B3F', ink: '#FFFFFF', accent: '#CDFD51', mark: 'tgf' } },
  hiddentrip: { id: 'hiddentrip', name: 'Hidden Trip', handle: 'hiddentrip', posts: '78', followers: '116K', following: '0', verified: false, bio: ['Travel | Guides | Budget Hacks', 'Save Money. Travel Better.'], avatar: { bg: '#2B65F5', ink: '#FEFF55', mark: 'arrow' } },
  tezscroll: { id: 'tezscroll', name: 'Tezscroll', handle: 'tezscroll', posts: '481', followers: '144K', following: '3', verified: true, bio: ['Facts over noise. Truth over trends', 'Break the Silence, Break the Chain'], avatar: { bg: '#952F2A', ink: '#FFFFFF', mark: 'word', text: 'TezScroll' } },
  fluxpedia: { id: 'fluxpedia', name: 'Fluxpedia', handle: 'fluxpedia', posts: '—', followers: '—', following: '—', verified: false, bio: ['Media IPs'], avatar: { bg: '#FFFFFF', ink: '#5B2D8F', mark: 'logo' } },
  generic: { id: 'generic', name: 'yourpage', handle: 'yourpage', posts: '214', followers: '12,480', following: '312', verified: false, bio: [], avatar: { bg: '#E5E7EB', ink: '#111', mark: 'initial', text: 'Y' } },
};
