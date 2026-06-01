'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

interface DossierTabsProps {
  synthese: React.ReactNode;
  documents: React.ReactNode;
  documentCount: number;
}

/**
 * Tab switcher for the dossier page.
 * Syncs the active tab via `?tab=` search param; default is 'synthese'.
 */
export function DossierTabs({ synthese, documents, documentCount }: DossierTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeTab = searchParams.get('tab') ?? 'synthese';

  function switchTab(tab: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'synthese'}
          className={'tab' + (activeTab === 'synthese' ? ' tab-active' : '')}
          onClick={() => switchTab('synthese')}
        >
          Synthèse
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'documents'}
          className={'tab' + (activeTab === 'documents' ? ' tab-active' : '')}
          onClick={() => switchTab('documents')}
        >
          Documents ({documentCount})
        </button>
      </div>

      <div role="tabpanel">
        {activeTab === 'synthese' ? synthese : documents}
      </div>
    </div>
  );
}
