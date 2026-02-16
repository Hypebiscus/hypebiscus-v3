// src/components/dashboard-components/BtcFilterDropdown.tsx
"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

const TOKEN_LOGOS: Record<string, string> = {
  btc: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png",
  eth: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png",
  sol: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  usdc: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
};

interface BtcFilterDropdownProps {
  onFilterSelect: (filter: string) => void;
  isLoading: boolean;
  activeFilter?: string;
}

const BtcFilterDropdown: React.FC<BtcFilterDropdownProps> = ({
  onFilterSelect,
  isLoading,
  activeFilter
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const filterOptions = [
    {
      id: 'wbtc-sol',
      label: 'wBTC',
      description: 'Wrapped Bitcoin pools',
      logos: ['btc', 'sol'],
    },
    {
      id: 'zbtc-sol',
      label: 'zBTC',
      description: 'Zeus Bitcoin pools',
      logos: ['btc', 'sol'],
    },
    {
      id: 'cbbtc-sol',
      label: 'cbBTC',
      description: 'Coinbase Bitcoin pools',
      logos: ['btc', 'sol'],
    },
    {
      id: 'eth-sol',
      label: 'ETH',
      description: 'Ethereum / SOL pools',
      logos: ['eth', 'sol'],
    },
    {
      id: 'sol-usdc',
      label: 'SOL-USDC',
      description: 'SOL / USDC pools',
      logos: ['sol', 'usdc'],
    }
  ];

  const getActiveFilterLabel = () => {
    const activeOption = filterOptions.find(option => option.id === activeFilter);
    if (activeOption) {
      return activeOption.label; // Just show the token name without "Token:" prefix
    }
    return "Token";
  };

  const handleFilterSelect = (filterId: string) => {
    onFilterSelect(filterId);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Dropdown Trigger Button */}
      <Button
        variant="secondary"
        size="secondary"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className="bg-secondary/30 border-primary text-white flex items-center gap-2 hover:bg-primary/20 min-w-[80px] sm:min-w-[100px] justify-between text-xs"
      >
        <span className="truncate">{getActiveFilterLabel()}</span>
        <ChevronDown 
          className={`w-4 h-4 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} 
        />
      </Button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Overlay to close dropdown when clicking outside */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown Content */}
          <div className="absolute top-full left-0 mt-1 bg-[#161616] border border-primary rounded-lg shadow-lg z-20 overflow-hidden w-[280px] sm:w-[320px]">
            {filterOptions.map((option) => {
              const isSelected = activeFilter === option.id;

              return (
                <button
                  key={option.id}
                  onClick={() => handleFilterSelect(option.id)}
                  disabled={isLoading}
                  className={`w-full px-6 py-4 text-left hover:bg-primary/20 transition-colors flex items-center gap-4 ${
                    isSelected ? 'bg-primary/10' : ''
                  } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="flex -space-x-1.5 flex-shrink-0">
                    {option.logos.map((token) => (
                      <Image
                        key={token}
                        src={TOKEN_LOGOS[token]}
                        alt={token}
                        width={22}
                        height={22}
                        className="rounded-full ring-1 ring-black"
                      />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-base font-medium truncate">
                      {option.label}
                    </div>
                    <div className="text-sub-text text-sm truncate mt-1">
                      {option.description}
                    </div>
                  </div>
                  {isSelected && (
                    <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default BtcFilterDropdown;