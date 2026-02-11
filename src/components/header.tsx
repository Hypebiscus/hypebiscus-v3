// src/components/header.tsx
"use client";

import { useState, useEffect } from "react";
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
import { usePathname } from "next/navigation";
import LPStatusBadge from "@/components/LPStatusBadge";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";

const navItems = [
  { label: "Home", path: "/" },
  { label: "Pricing", path: "/pricing" },
  { label: "Bridge", path: "/bridge" },
  { label: "Portfolio", path: "/wallet" },
  { label: "Link", path: "/link" },
];

function ConnectButton() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();

  const label = isConnected && address
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : "Connect Wallet";

  return (
    <button
      onClick={() => open()}
      className="bg-[#FF4040] hover:bg-[#E03636] text-white font-mono text-sm px-4 py-2 transition-colors cursor-pointer"
    >
      {label}
    </button>
  );
}

const Header = () => {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="relative flex justify-between items-center lg:px-[70px] px-4 py-4">
      {/* Logo */}
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

      {/* Desktop Navigation - Absolutely centered */}
      <nav className="hidden lg:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`font-mono text-sm transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-white/70 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Right Section */}
      <div className="flex items-center gap-3 md:gap-4">
        {/* LP Status Badge */}
        {mounted && <LPStatusBadge />}

        {/* Mobile Navigation Menu */}
        <NavigationMenu className="lg:hidden block">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger
                className="flex items-center gap-2"
                aria-label="Open navigation menu"
              >
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
                        <WalletIcon className="text-primary" /> Portfolio
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
        {mounted && <ConnectButton />}
      </div>
    </div>
  );
};

export default Header;