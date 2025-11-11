"use client";

import Header from "@/components/header";
import Menu from "@/components/menu";
import PoolMetricsDashboard from "@/components/dashboard-components/PoolMetricsDashboard";

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen flex-col relative">
      <Header />
      <main className="w-full flex-1 lg:gap-4 relative lg:px-[70px] px-4 mt-6 lg:mt-0">
        <div className="absolute top-0 left-4 lg:flex justify-center items-center h-full hidden">
          <Menu />
        </div>
        <div className="flex-1 py-8">
          <PoolMetricsDashboard />
        </div>
      </main>
    </div>
  );
}
