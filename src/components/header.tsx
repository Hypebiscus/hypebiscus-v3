// src/components/header.tsx
"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  HouseIcon,
  LightningIcon,
  WalletIcon,
  ListIcon,
  LinkIcon,
  CreditCardIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import Image from "next/image";
import LPStatusBadge from "@/components/LPStatusBadge";

// Dynamically import WalletMultiButton with ssr disabled
const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const Header = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex justify-between items-center lg:px-[70px] px-4 pt-4 lg:pb-4 pb-0">
      <div>
        <Image
          src="/hypebiscus_logo.png"
          alt="Hypebiscus"
          width={72}
          height={72}
          className="object-cover w-full h-[24px] md:h-[32px]"
          unoptimized
        />
      </div>

      <div className="flex items-center gap-3 md:gap-4">
        {/* LP Status Badge */}
        {mounted && <LPStatusBadge />}

        {/* Mobile Navigation Menu */}
        <NavigationMenu className="lg:hidden block">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger className="flex items-center gap-2">
                <ListIcon />
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="flex flex-col gap-y-4 p-2">
                  <li>
                    <NavigationMenuLink asChild>
                      <Link href="/">
                        <HouseIcon className="text-primary" /> Home
                      </Link>
                    </NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink asChild>
                      <Link href="/pricing">
                        <CreditCardIcon className="text-primary" /> Pricing
                      </Link>
                    </NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink asChild>
                      <Link href="/bridge">
                        <LightningIcon className="text-primary" /> Bridge
                      </Link>
                    </NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink asChild>
                      <Link href="/wallet">
                        <WalletIcon className="text-primary" /> Wallet
                      </Link>
                    </NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink asChild>
                      <Link href="/link">
                        <LinkIcon className="text-primary" /> Link
                      </Link>
                    </NavigationMenuLink>
                  </li>
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        {/* Wallet Connect Button */}
        {mounted && (
          <WalletMultiButton
            style={{
              backgroundColor: "var(--primary)",
              padding: "12px 16px",
              borderRadius: "12px",
              fontSize: "14px",
              fontFamily: "var(--font-sans)",
              height: "100%",
              lineHeight: "100%",
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Header;