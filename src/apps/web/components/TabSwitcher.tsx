'use client';

interface Tab {
  key: string;
  label: string;
}

interface TabSwitcherProps {
  tabs: Tab[];
  activeKey: string;
  onTabChange: (key: string) => void;
}

export function TabSwitcher({ tabs, activeKey, onTabChange }: TabSwitcherProps) {
  return (
    <div className="tab-switcher" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`tab-switcher-tab${tab.key === activeKey ? ' tab-switcher-tab--active' : ''}`}
          role="tab"
          aria-selected={tab.key === activeKey}
          onClick={() => onTabChange(tab.key)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
