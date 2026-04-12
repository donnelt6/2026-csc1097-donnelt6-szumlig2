'use client';

// page.tsx: Hubs list page with create-hub modal, filtering, and toolbar.

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DashboardHome } from '../components/dashboard/DashboardHome';
import { DashboardCalendar } from '../components/dashboard/DashboardCalendar';
import { DashboardActivity } from '../components/dashboard/DashboardActivity';

function HomeContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') ?? 'home';

  return (
    <main className="page-content page-content--dash">
      <div className="dash-page">
        {tab === 'home' && <DashboardHome />}
        {tab === 'calendar' && <DashboardCalendar />}
        {tab === 'activity' && <DashboardActivity />}
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
