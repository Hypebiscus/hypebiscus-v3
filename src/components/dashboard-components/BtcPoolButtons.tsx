// src/components/dashboard-components/BtcPoolButtons.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Bitcoin, Search } from "lucide-react";

interface BtcPoolButtonsProps {
  onFetchPools: (searchTerm: string) => void;
  isLoading: boolean;
  activeFilter?: string;
}

const BtcPoolButtons: React.FC<BtcPoolButtonsProps> = ({ 
  onFetchPools, 
  isLoading,
  activeFilter 
}) => {
  const filterOptions = [
    {
      id: 'wbtc-sol',
      label: 'wBTC-SOL',
      description: 'Wrapped Bitcoin',
      icon: Bitcoin
    },
    {
      id: 'zbtc-sol',
      label: 'zBTC-SOL',
      description: 'Zeus Bitcoin',
      icon: Bitcoin
    },
    {
      id: 'cbbtc-sol',
      label: 'cbBTC-SOL',
      description: 'Coinbase Bitcoin',
      icon: Bitcoin
    },
    {
      id: 'eth-sol',
      label: 'ETH-SOL',
      description: 'Ethereum',
      icon: Bitcoin
    },
    {
      id: 'sol-usdc',
      label: 'SOL-USDC',
      description: 'SOL / USDC',
      icon: Bitcoin
    },
    {
      id: 'btc',
      label: 'All BTC',
      description: 'All Bitcoin pools',
      icon: Search
    }
  ];

  return (
    <div className="flex flex-col space-y-3 mb-4">
      <p className="text-sm text-sub-text mb-1">Filter by Token Pair:</p>
      
      {/* Desktop Layout - 2x2 Grid with Portfolio Button Style */}
      <div className="hidden md:grid md:grid-cols-2 gap-2">
        {filterOptions.map((option) => {
          const Icon = option.icon;
          const isActive = activeFilter === option.id;
          
          return (
            <Button
              key={option.id}
              variant="secondary"
              size="secondary"
              onClick={() => onFetchPools(option.id)}
              disabled={isLoading}
              className={`bg-secondary/30 border-primary text-white flex items-center gap-2 hover:bg-primary/20 ${
                isActive ? 'bg-primary/20' : ''
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>
                {option.id === 'btc' ? option.label : `Pool: ${option.label}`}
              </span>
            </Button>
          );
        })}
      </div>

      {/* Mobile Layout - Horizontal Scroll with Portfolio Button Style */}
      <div className="md:hidden flex overflow-x-auto gap-2 pb-2 scrollbar-hide">
        {filterOptions.map((option) => {
          const Icon = option.icon;
          const isActive = activeFilter === option.id;
          
          return (
            <Button
              key={option.id}
              variant="secondary"
              size="secondary"
              onClick={() => onFetchPools(option.id)}
              disabled={isLoading}
              className={`bg-secondary/30 border-primary text-white flex items-center gap-2 hover:bg-primary/20 whitespace-nowrap flex-shrink-0 ${
                isActive ? 'bg-primary/20' : ''
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>
                {option.id === 'btc' ? option.label : `Pool: ${option.label}`}
              </span>
            </Button>
          );
        })}
      </div>

      {/* Loading Indicator */}
      {isLoading && (
        <div className="text-xs text-sub-text animate-pulse">
          Searching for pools...
        </div>
      )}
    </div>
  );
};

export default BtcPoolButtons;