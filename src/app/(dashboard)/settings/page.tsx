"use client";
import { useEffect } from "react";
import { useHeaderTitle } from "@/context/HeaderTitleContext"; // Component to set the page title in the dashbaoard header
import SettingsClientPage from "./components/SettingsClientPage"


export default function SettingsPage() {
  const { setHeaderTitle } = useHeaderTitle();

  useEffect(() => {
    setHeaderTitle("Settings"); // Set the header title for this page
  }, [setHeaderTitle]);

  return <SettingsClientPage />
}

