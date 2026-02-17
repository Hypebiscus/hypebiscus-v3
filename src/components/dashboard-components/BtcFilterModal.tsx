"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface BtcFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
  onSelectFilter: (filter: string) => void;
}

type BtcFilterOption = {
  id: string;
  title: string;
  description: string;
  icon: string;
};

const TOKEN_LOGOS: Record<string, string> = {
  btc: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png",
  eth: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png",
  sol: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  usdc: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
};

const BtcFilterModal: React.FC<BtcFilterModalProps> = ({
  isOpen,
  onClose,
  onBack,
  onSelectFilter,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);

  const filterOptions: BtcFilterOption[] = [
    {
      id: "wbtc-sol",
      title: "wBTC-SOL",
      description: "Wrapped Bitcoin and Solana",
      icon: "btc,sol",
    },
    {
      id: "zbtc-sol",
      title: "zBTC-SOL",
      description: "Zeus Bitcoin and Solana",
      icon: "btc,sol",
    },
    {
      id: "cbbtc-sol",
      title: "cbBTC-SOL",
      description: "Coinbase Bitcoin and Solana",
      icon: "btc,sol",
    },
    {
      id: "eth-sol",
      title: "ETH-SOL",
      description: "Wrapped Ethereum and Solana",
      icon: "eth,sol",
    },
    {
      id: "sol-usdc",
      title: "SOL-USDC",
      description: "Solana and USDC Stablecoin",
      icon: "sol,usdc",
    },
  ];

  const handleFilterSelect = (filterId: string) => {
    setSelectedFilter(filterId);
  };

  const handleConfirm = () => {
    if (selectedFilter) {
      onSelectFilter(selectedFilter);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent aria-describedby="btc-filter-description">
        <DialogTitle className="text-center text-2xl font-bold">
          Choose Token Pair
        </DialogTitle>
        <DialogDescription id="btc-filter-description" className="sr-only">
          Choose token pair
        </DialogDescription>

        {/* Modal Content */}
        <div className='pt-8'>
          {/* Options */}
          <div className="space-y-3 mb-8">
            {filterOptions.map((filter) => {
              const isSelected = selectedFilter === filter.id;
              
              return (
                <div
                  key={filter.id}
                  className={`cursor-pointer rounded-2xl border px-5 py-4 transition-all ${
                    isSelected ? "bg-primary border-primary" : "bg-transparent border-primary"
                  }`}
                  onClick={() => handleFilterSelect(filter.id)}
                  role="radio"
                  aria-checked={isSelected}
                  aria-labelledby={`filter-${filter.id}-title`}
                  aria-describedby={`filter-${filter.id}-desc`}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleFilterSelect(filter.id);
                    }
                  }}
                >
                  <div className="flex items-center">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <div className="flex -space-x-2" aria-hidden="true">
                          {filter.icon.split(",").map((token) => (
                            <Image
                              key={token}
                              src={TOKEN_LOGOS[token]}
                              alt={token}
                              width={28}
                              height={28}
                              className="rounded-full ring-2 ring-black"
                            />
                          ))}
                        </div>
                        <h3 id={`filter-${filter.id}-title`} className="font-medium text-white">
                          {filter.title} <span id={`filter-${filter.id}-desc`} className="text-sm text-sub-text">- {filter.description}</span>
                        </h3>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Action Buttons */}
          <div className="flex gap-3">
            {onBack && (
              <Button
                variant="outline"
                onClick={onBack}
                className="flex-1"
              >
                Back
              </Button>
            )}
            <Button
              variant="default"
              onClick={handleConfirm}
              disabled={!selectedFilter}
              className="flex-1"
            >
              Continue
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BtcFilterModal;