"use client";

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface PortfolioStyleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStyle: (style: string) => void;
}

type PortfolioStyle = {
  id: string;
  title: string;
  description: string;
  icon?: string;
};

const PortfolioStyleModal: React.FC<PortfolioStyleModalProps> = ({ 
  isOpen, 
  onClose,
  onSelectStyle
}) => {
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  
  const portfolioStyles: PortfolioStyle[] = [
    {
      id: 'conservative',
      title: 'Conservative',
      description: 'Stable pools, lower risk, smaller returns.',
      icon: '🛡️'
    },
    {
      id: 'moderate',
      title: 'Moderate',
      description: 'Mixed pools, balanced risk and returns.',
      icon: '⚖️'
    },
    {
      id: 'aggressive',
      title: 'Aggressive',
      description: 'Higher-yield pools, higher risk, bigger returns.',
      icon: '🚀'
    }
  ];
  
  const handleStyleSelect = (styleId: string) => {
    setSelectedStyle(styleId);
  };
  
  const handleConfirm = () => {
    if (selectedStyle) {
      onSelectStyle(selectedStyle);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent aria-describedby="portfolio-style-description">
        <DialogTitle className='text-center text-2xl font-bold'>
          Choose Your Portfolio Style
        </DialogTitle>
        <DialogDescription id="portfolio-style-description" className="sr-only">
          Choose your portfolio style
        </DialogDescription>
        
        {/* Modal Content */}
        <div className='pt-8'>  
          {/* Options */}
          <div className="space-y-3 mb-8" role="radiogroup" aria-labelledby="portfolio-style-description">
            {portfolioStyles.map((style) => {
              const isSelected = selectedStyle === style.id;
              
              return (
                <div
                  key={style.id}
                  className={`cursor-pointer rounded-2xl border px-5 py-4 transition-all ${
                    isSelected ? "bg-primary border-primary" : "bg-transparent border-primary"
                  }`}
                  onClick={() => handleStyleSelect(style.id)}
                  role="radio"
                  aria-checked={isSelected}
                  aria-labelledby={`style-${style.id}-title`}
                  aria-describedby={`style-${style.id}-desc`}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleStyleSelect(style.id);
                    }
                  }}
                >
                  <div className="flex items-center">
                    <div className="flex-1">
                      <div className="flex items-center">
                        {style.icon && <span className="mr-2" aria-hidden="true">{style.icon}</span>}
                        <h3 id={`style-${style.id}-title`} className="font-medium text-white">
                          {style.title}
                        </h3>
                      </div>
                      <p id={`style-${style.id}-desc`} className="text-sm text-white mt-1">
                        {style.description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Continue Button */}
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={!selectedStyle}
            className="w-full"
          >
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PortfolioStyleModal;