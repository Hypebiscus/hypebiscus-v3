// src/components/menu.tsx
"use client"

import { Button } from "@/components/ui/button"
import { HouseIcon, WalletIcon, LightningIcon, ChartLineIcon } from "@phosphor-icons/react"
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const Menu = () => {
  const pathname = usePathname()
  const menuItems = [
    {
      label: "Home",
      icon: HouseIcon,
      path: "/",
    },
    {
      label: "Dashboard",
      icon: ChartLineIcon,
      path: "/dashboard",
    },
    {
      label: "Premium",
      emoji: "🤖",
      path: "/premium",
    },
    {
      label: "Pricing",
      emoji: "💳",
      path: "/mcp",
    },
    {
      label: "Bridge",
      icon: LightningIcon,
      path: "/bridge",
    },
    {
      label: "Wallet",
      icon: WalletIcon,
      path: "/wallet",
    },
  ]

  return (
    <div className="">
      <div className="bg-[#161616] rounded-full w-[48px] h-[280px] border-border flex flex-col justify-center items-center">
        <div className="flex flex-col gap-2">
          {menuItems.map((item, index) => {
            const isActive = pathname === item.path
            const Icon = item.icon

            return (
              <Link href={item.path} key={index}>
                <Button 
                  variant={isActive ? "default" : "ghost"} 
                  className={`relative rounded-2xl w-[32px] h-[32px] ${isActive ? 'bg-primary text-white' : 'hover:bg-primary/20 hover:text-white'}`} 
                  title={item.label}
                >
                  {item.emoji ? (
                    <span className="text-lg">{item.emoji}</span>
                  ) : Icon ? (
                    <Icon />
                  ) : null}
                </Button>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default Menu