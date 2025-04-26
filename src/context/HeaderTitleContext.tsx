// src/context/HeaderTitleContext.tsx
"use client";

import * as React from "react";

type HeaderTitleContextType = {
  headerTitle: string;
  setHeaderTitle: (title: string) => void;
};

const HeaderTitleContext = React.createContext<HeaderTitleContextType | undefined>(undefined);

export function HeaderTitleProvider({ children }: { children: React.ReactNode }) {
  const [headerTitle, setHeaderTitle] = React.useState<string>("Documents"); // default title

  return (
    <HeaderTitleContext.Provider value={{ headerTitle, setHeaderTitle }}>
      {children}
    </HeaderTitleContext.Provider>
  );
}

export function useHeaderTitle() {
  const context = React.useContext(HeaderTitleContext);
  if (!context) {
    throw new Error("useHeaderTitle must be used within a HeaderTitleProvider");
  }
  return context;
}
