import type * as React from 'react';
import { Feed } from './feed';
import { Profile } from './profile';
import { Chronology } from './chronology';
import type { TemplateProps } from './types';

export type TemplateKey = 'feed' | 'profile' | 'chronology';

export const TEMPLATES: Record<
  TemplateKey,
  { label: string; Component: (p: TemplateProps) => React.JSX.Element }
> = {
  feed: { label: 'Fil', Component: Feed },
  profile: { label: 'Profil', Component: Profile },
  chronology: { label: 'Chronologie', Component: Chronology },
};

export function resolveTemplate(key: string): TemplateKey {
  return key === 'profile' || key === 'chronology' || key === 'feed' ? key : 'feed';
}
