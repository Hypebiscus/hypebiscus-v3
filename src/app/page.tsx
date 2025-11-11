"use client";

import { useState } from "react";
import ChatBox from "@/components/dashboard-components/ChatBox";
import PoolMetricsDashboard from "@/components/dashboard-components/PoolMetricsDashboard";
import Header from "@/components/header";
import Menu from "@/components/menu";
import { Button } from "@/components/ui/button";
import { ChartLine, ChatCircle } from "@phosphor-icons/react";

export default function Home() {
  const [showMetrics, setShowMetrics] = useState(false);

  return (
    <div className="flex min-h-screen flex-col relative">
      <Header />
      <main className="w-full flex-1 lg:gap-4 relative lg:px-[70px] px-4 mt-6 lg:mt-0">
        <div className="absolute top-0 left-4 lg:flex justify-center items-center h-full hidden">
          <Menu />
        </div>
        <div className="flex-1">
          {/* Toggle Button */}
          <div className="flex justify-end mb-4 gap-2">
            <Button
              variant={!showMetrics ? "default" : "outline"}
              size="sm"
              onClick={() => setShowMetrics(false)}
              className="flex items-center gap-2"
            >
              <ChatCircle size={16} weight={!showMetrics ? "fill" : "regular"} />
              AI Chat
            </Button>
            <Button
              variant={showMetrics ? "default" : "outline"}
              size="sm"
              onClick={() => setShowMetrics(true)}
              className="flex items-center gap-2"
            >
              <ChartLine size={16} weight={showMetrics ? "bold" : "regular"} />
              Pool Metrics
            </Button>
          </div>

          {/* Content */}
          {showMetrics ? (
            <div className="py-4">
              <PoolMetricsDashboard />
            </div>
          ) : (
            <ChatBox />
          )}
        </div>
      </main>
    </div>
  );
}
// export default function Home() {
//   const [showNewsOnMobile, setShowNewsOnMobile] = useState(false);

//   return (
    
//       <div className="relative h-full flex flex-col">
//         <div className="flex justify-end mb-4 lg:hidden">
//           <Button
//             variant="outline"
//             size="sm"
//             onClick={() => setShowNewsOnMobile(!showNewsOnMobile)}
//             className="flex items-center gap-2"
//           >
//             {showNewsOnMobile ? <X size={16} /> : <Newspaper size={16} />}
//             {showNewsOnMobile ? "Close News" : "Open News"}
//           </Button>
//         </div>

//         <div className="w-full lg:h-full lg:flex justify-between  gap-4 relative flex-grow overflow-hidden">
//           <div 
//             className={`w-full h-full transition-all duration-300 ease-in-out ${
//               showNewsOnMobile ? "opacity-0 translate-x-[-100%] absolute" : "opacity-100 translate-x-0"
//             }`}
//           >
//             <ChatBox />
//           </div>
//           <div 
//             className={`transition-all duration-300 ease-in-out ${
//               showNewsOnMobile 
//                 ? "w-full opacity-100 translate-x-0" 
//                 : "min-w-[300px] max-w-sm lg:block opacity-0 translate-x-[100%] lg:opacity-100 lg:translate-x-0"
//             }`}
//           >
//             <News />
//           </div>
//         </div>
//       </div>
   
//   );
// }
