'use client';

import { ArchiveBoxIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export default function VaultPage() {
  return (
    <main className="page-content page-content--hubs">
      <div className="content-inner">
        <div className="placeholder-page">
          <div className="placeholder-page-icons">
            <ArchiveBoxIcon className="placeholder-page-icon" />
            <MagnifyingGlassIcon className="placeholder-page-icon" />
          </div>
          <h2 className="placeholder-page-title">Vault</h2>
          <p className="placeholder-page-desc">
            Coming soon: Browse recently accessed files across all hubs, recently uploaded sources, and search across your entire workspace.
          </p>
        </div>
      </div>
    </main>
  );
}
