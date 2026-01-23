import Header from "@/components/header";
import { ReactNode } from "react";

interface PageTemplateProps {
  children: ReactNode;
}

const PageTemplate = ({ children }: PageTemplateProps) => {
  return (
    <div className="flex min-h-screen flex-col relative">
      <Header />
      <main className="w-full flex-1 lg:px-[70px] px-4">
        {children}
      </main>
    </div>
  );
};

export default PageTemplate;
