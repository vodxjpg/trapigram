"use client";

export default function PruebaPage() {
  async function pruebas() {
    try {
      const res = await fetch("api/test/");
    } catch (error) {}
  }

  pruebas();
  return <div></div>;
}
