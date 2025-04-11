"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";

// ---------- Countries Setup ----------
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";

countriesLib.registerLocale(enLocale);
const allCountries = getCountries().map((code) => ({
  code,
  name: countriesLib.getName(code, "en") || code,
}));

// ---------- Announcement Schema ----------
// The schema below validates the fields for announcements.
const announcementFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  expirationDate: z.string().nullable().optional(),
  countries: z.array(z.string().length(2)).min(1, "At least one country is required"),
  status: z.string().min(1, "Status is required"),
  sent: z.boolean(),
});

type AnnouncementFormValues = z.infer<typeof announcementFormSchema>;

type AnnouncementFormProps = {
  announcementData?: AnnouncementFormValues | null;
  isEditing?: boolean;
};

export function AnnouncementForm({
  announcementData,
  isEditing = false,
}: AnnouncementFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [date, setDate] = useState<Date | null>(null);
  const [openDatePicker, setOpenDatePicker] = useState(false);

  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementFormSchema),
    defaultValues: {
      title: "",
      content: "",
      expirationDate: null,
      countries: [],
      status: "",
      sent: false,
    },
  });

  const [announcementValue, setAnnouncementValue] = useState('');

  useEffect(() => {
    if (isEditing && announcementData) {
      // Ensure the countries field is an array.
      const countriesValue =
        Array.isArray(announcementData.countries)
          ? announcementData.countries
          : typeof announcementData.countries === "string"
          ? JSON.parse(announcementData.countries)
          : [];
      form.reset({
        ...announcementData,
        countries: countriesValue,
      });
      if (announcementData.expirationDate) {
        setDate(new Date(announcementData.expirationDate));
      } else {
        setDate(null);
      }
    } else {
      form.reset({
        title: "",
        content: "",
        expirationDate: null,
        countries: [],
        status: "",
        sent: false,
      });
      setDate(null);
    }
  }, [announcementData, form, isEditing]);

  async function onSubmit(values: AnnouncementFormValues) {
    setIsSubmitting(true);
    try {
      const url = isEditing
        ? `/api/announcements/${announcementData?.id}`
        : "/api/announcements";
      const method = isEditing ? "PATCH" : "POST";

      const payload = {
        ...values,
        countries: JSON.stringify(values.countries),
      };

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ||
            `Failed to ${isEditing ? "update" : "create"} announcement`
        );
      }
      toast.success(
        isEditing
          ? "Announcement updated successfully"
          : "Announcement created successfully"
      );
      router.push("/announcements");
      router.refresh();
    } catch (error: any) {
      console.error(
        `Error ${isEditing ? "updating" : "creating"} announcement:`,
        error
      );
      toast.error(
        error.message ||
          `Failed to ${isEditing ? "update" : "create"} announcement`
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const addCountry = (code: string) => {
    const current = form.getValues("countries");
    if (!current.includes(code)) {
      form.setValue("countries", [...current, code]);
    }
    setCountrySearch("");
  };

  const removeCountry = (code: string) => {
    const current = form.getValues("countries");
    form.setValue("countries", current.filter((c) => c !== code));
  };

  const filteredCountries = allCountries.filter(
    (c) =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.code.toLowerCase().includes(countrySearch.toLowerCase())
  );
  const modules = {
    toolbar: [
      [{ 'header': [1, 2, false] }],
      ['bold', 'italic', 'underline','strike', 'blockquote'],
      [{'list': 'ordered'}, {'list': 'bullet'}, {'indent': '-1'}, {'indent': '+1'}],
      ['link', 'image'],
      ['clean']
    ],
  }

  const formats = [
    'header',
    'bold', 'italic', 'underline', 'strike', 'blockquote',
    'list', 'indent',
    'link', 'image'
  ]

  return (
    <Card className="w-full mx-auto">
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Row 1: Title and Status */}
              <div>
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title *</FormLabel>
                      <FormControl>
                        <Input placeholder="Announcement Title" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div>
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status *</FormLabel>
                      <FormControl>
                        <Input placeholder="Announcement Status" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 2: Content (span both columns) */}
              <div className="md:col-span-2">
                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Content *</FormLabel>
                      <FormControl>
                        <ReactQuill theme="snow" value={announcementValue} onChange={setAnnouncementValue} modules={modules} formats={formats} {...field}/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 3: Countries (span both columns) */}
              <div className="md:col-span-2">
                <FormField
                  control={form.control}
                  name="countries"
                  render={() => (
                    <FormItem>
                      <FormLabel>Countries *</FormLabel>
                      <div className="mb-2">
                        <Input
                          placeholder="Search country..."
                          value={countrySearch}
                          onChange={(e) => setCountrySearch(e.target.value)}
                        />
                        {countrySearch && filteredCountries.length > 0 && (
                          <div className="border mt-1 p-2 max-h-36 overflow-y-auto bg-white">
                            {filteredCountries.map((country) => (
                              <div
                                key={country.code}
                                className="flex items-center gap-2 p-1 hover:bg-gray-100 cursor-pointer"
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
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {form.watch("countries").map((code: string) => {
                          const country = allCountries.find((c) => c.code === code);
                          if (!country) return null;
                          return (
                            <div
                              key={code}
                              className="border border-gray-300 px-2 py-1 rounded-full flex items-center"
                            >
                              <ReactCountryFlag
                                countryCode={country.code}
                                svg
                                className="inline-block mr-1"
                              />
                              <span className="mr-2 text-sm">
                                {country.name} ({country.code})
                              </span>
                              <button
                                type="button"
                                onClick={() => removeCountry(code)}
                                className="text-red-500 text-sm font-bold"
                              >
                                x
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 4: Has Expiration and Expiration Date */}
              <div>
                <FormField
                  control={form.control}
                  name="hasExpiration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Has Expiration Date?</FormLabel>
                      <FormControl>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            className="h-4 w-4"
                          />
                          <span>{field.value ? "Yes" : "No"}</span>
                        </label>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div>
                {form.watch("hasExpiration") && (
                  <FormField
                    control={form.control}
                    name="expirationDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expiration Date</FormLabel>
                        <FormControl>
                          <Popover open={openDatePicker} onOpenChange={setOpenDatePicker}>
                            <PopoverTrigger asChild>
                              <Button
                                variant={"outline"}
                                onClick={() => setOpenDatePicker(true)}
                                className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date ? format(date, "PPP") : <span>Pick a date</span>}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={date}
                                onSelect={(d: Date | null) => {
                                  setDate(d);
                                  if (d) {
                                    field.onChange(d.toISOString().split("T")[0]);
                                  } else {
                                    field.onChange(null);
                                  }
                                  setOpenDatePicker(false);
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {/* Row 5: Sent */}
              <div className="md:col-span-2">
                <FormField
                  control={form.control}
                  name="sent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sent</FormLabel>
                      <FormControl>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            className="h-4 w-4"
                          />
                          <span>{field.value ? "Yes" : "No"}</span>
                        </label>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Submit/Cancel Buttons */}
            <div className="flex justify-center gap-4 mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/announcements")}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? isEditing
                    ? "Updating..."
                    : "Creating..."
                  : isEditing
                  ? "Update Announcement"
                  : "Create Announcement"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
