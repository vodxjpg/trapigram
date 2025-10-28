"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import ReactCountryFlag from "react-country-flag";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";

countriesLib.registerLocale(enLocale);

export type CountryPickerProps = {
    /** Array of ISO 3166-1 alpha-2 codes, e.g., ["US","ES"] */
    value: string[];
    /** Called with the new list after add/remove */
    onChange: (next: string[]) => void;
    /** Optional wrapper class */
    className?: string;
    /** Placeholder for the search input */
    inputPlaceholder?: string;
    /** Max height for the dropdown list (px or any CSS size) */
    listMaxHeight?: number | string;
};

type Country = { code: string; name: string };

/**
 * Simple country picker with search + chips.
 * No "select all / deselect all". Mirrors the original drawer UI.
 */
export default function CountryPicker({
    value,
    onChange,
    className,
    inputPlaceholder = "Search country...",
    listMaxHeight = 144, // ~36*4 same as original max-h-36
}: CountryPickerProps) {
    const [search, setSearch] = useState("");

    const allCountries: Country[] = useMemo(
        () =>
            getCountries().map((code) => ({
                code,
                name: countriesLib.getName(code, "en") || code,
            })),
        []
    );

    const filteredCountries = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return [];
        return allCountries.filter(
            (c) =>
                c.name.toLowerCase().includes(q) ||
                c.code.toLowerCase().includes(q)
        );
    }, [allCountries, search]);

    const addCountry = (code: string) => {
        if (!value.includes(code)) {
            onChange([...value, code]);
        }
        setSearch("");
    };

    const removeCountry = (code: string) => {
        onChange(value.filter((c) => c !== code));
    };

    const listStyle =
        typeof listMaxHeight === "number" ? { maxHeight: `${listMaxHeight}px` } : { maxHeight: listMaxHeight };

    // Ensure the component never exceeds its container: always w-full
    const rootClass = ["w-full", className].filter(Boolean).join(" ");

    return (
        <div className={rootClass}>
            {/* Search input */}
            <div className="mb-2">
                <Input
                    placeholder={inputPlaceholder}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full"
                />
                {search && filteredCountries.length > 0 && (
                    <div
                        className="border mt-1 p-2 overflow-y-auto bg-white w-full"
                        style={listStyle}
                    >
                        {filteredCountries.map((country) => (
                            <button
                                key={country.code}
                                type="button"
                                className="w-full text-left flex items-center gap-2 p-1 hover:bg-gray-100 cursor-pointer"
                                onClick={() => addCountry(country.code)}
                            >
                                <ReactCountryFlag
                                    countryCode={country.code}
                                    svg
                                    className="inline-block mr-2"
                                />
                                <span>
                                    {country.name} ({country.code})
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Selected chips */}
            <div className="flex flex-wrap gap-2">
                {value.map((code) => {
                    const c = allCountries.find((x) => x.code === code);
                    if (!c) return null;
                    return (
                        <div
                            key={code}
                            className="border border-gray-300 px-2 py-1 rounded-full flex items-center"
                        >
                            <ReactCountryFlag countryCode={c.code} svg className="inline-block mr-1" />
                            <span className="mr-2 text-sm">
                                {c.name} ({c.code})
                            </span>
                            <button
                                type="button"
                                onClick={() => removeCountry(code)}
                                className="text-red-500 text-sm font-bold"
                                aria-label={`Remove ${c.name}`}
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
