'use client';

import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useSearch } from "../../lib/SearchContext";
import { useIsPhone } from "../../lib/useIsPhone";

interface Props {
  placeholder: string;
}

export function MobileSearchBar({ placeholder }: Props) {
  const { searchQuery, setSearchQuery } = useSearch();
  const isPhone = useIsPhone();

  if (!isPhone) return null;

  return (
    <div className="hdash__mobile-search">
      <MagnifyingGlassIcon className="hdash__mobile-search-icon" />
      <input
        type="text"
        placeholder={placeholder}
        aria-label={placeholder}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="hdash__mobile-search-input"
      />
    </div>
  );
}
