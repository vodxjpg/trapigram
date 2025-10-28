"use client";

import { useMemo } from "react";
import ReactSelect from "react-select";
import ReactCountryFlag from "react-country-flag";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";

countriesLib.registerLocale(enLocale);

export type CountryMultiSelectProps = {
    countries: string[];                 // list of ISO country codes (e.g., "US", "GB", "ES")
    selectedCountries: string[];         // currently selected codes
    onChange: (next: string[]) => void;  // propagate new selection to parent
    className?: string;                  // optional wrapper width/styling (e.g., "w-full sm:w-[640px]")
    placeholder?: string;                // custom placeholder text
};

const SELECT_ALL = "__ALL__";
const DESELECT_ALL = "__NONE__";

export default function CountryMultiSelect({
    countries,
    selectedCountries,
    onChange,
    className,
    placeholder = "Select country(s)",
}: CountryMultiSelectProps) {
    // Countries from API -> react-select options
    const countryOptions = useMemo(
        () =>
            (countries ?? []).map((c) => ({
                value: c,
                label: countriesLib.getName(c, "en") || c,
            })),
        [countries]
    );

    // Include special items at the top
    const selectOptions = useMemo(
        () => [
            { value: SELECT_ALL, label: "SELECT ALL" },
            { value: DESELECT_ALL, label: "DESELECT ALL" },
            ...countryOptions,
        ],
        [countryOptions]
    );

    return (
        <div className={className}>
            <ReactSelect
                isMulti
                closeMenuOnSelect={false}
                hideSelectedOptions={false}
                classNamePrefix="rs"
                options={selectOptions}
                placeholder={placeholder}
                value={countryOptions.filter((o) => selectedCountries.includes(o.value))}
                // Preserve original selection logic, including special items
                onChange={(opts: any, actionMeta: any) => {
                    const clicked = actionMeta?.option as { value: string } | undefined;

                    // Handle special options when user clicks them
                    if (actionMeta?.action === "select-option" && clicked) {
                        if (clicked.value === SELECT_ALL) {
                            onChange(countries); // select all from API
                            return;
                        }
                        if (clicked.value === DESELECT_ALL) {
                            onChange([]); // clear all
                            return;
                        }
                    }

                    // Normal multi-select behavior
                    const next = Array.isArray(opts) ? opts : [];
                    onChange(
                        next
                            .filter((o) => o?.value !== SELECT_ALL && o?.value !== DESELECT_ALL)
                            .map((o) => o.value)
                    );
                }}
                formatOptionLabel={(o: any) =>
                    o.value === SELECT_ALL || o.value === DESELECT_ALL ? (
                        <div className="text-xs font-medium">{o.label}</div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <ReactCountryFlag countryCode={o.value} svg style={{ width: 20 }} />
                            <span>{o.label}</span>
                        </div>
                    )
                }
            />
        </div>
    );
}
