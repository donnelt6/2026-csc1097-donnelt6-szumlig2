'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DashboardHome } from '../../components/dashboard/DashboardHome';
import { DashboardCalendar } from '../../components/dashboard/DashboardCalendar';
import { DashboardActivity } from '../../components/dashboard/DashboardActivity';

function DashboardContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') ?? 'dashboard';

  return (
    <main className="page-content page-content--dash">
      <div className="dash-page">
        {tab === 'dashboard' && <DashboardHome />}
        {tab === 'calendar' && <DashboardCalendar />}
        {tab === 'activity' && <DashboardActivity />}
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
