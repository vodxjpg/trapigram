"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import Select from "react-select";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
// Temporarily using a simple div as Card since Card import is pending.
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";

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
const announcementFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  deliveryScheduled: z.boolean(),
  deliveryDate: z.string().nullable().optional(),
  countries: z.array(z.string()).min(1, "Select at least one country"),
  status: z.string().min(1, "Status is required"),
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
  const [date, setDate] = useState<Date | null>(null);
  const [openDatePicker, setOpenDatePicker] = useState(false);
  const [switchDelivery, setSwitchDelivery] = useState(false);
  // Country select options fetched from the endpoint.
  const [countryOptions, setCountryOptions] = useState<{ value: string; label: string }[]>([]);


  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementFormSchema),
    defaultValues: announcementData || {
      title: "",
      content: "",
      deliveryScheduled: false,
      deliveryDate: null,
      countries: [],
      status: "draft",
    },
  });



  // Fetch the countries for the organization from your endpoint.
  useEffect(() => {
    async function fetchOrganizationCountries() {
      try {
        const response = await fetch("/api/organizations/countries", {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!response.ok) {
          throw new Error("Failed to fetch organization countries");
        }
        const data = await response.json();
        // Assume data.countries is a JSON string or comma-separated list.
        let orgCountries: string[] = [];
        try {
          const parsed = JSON.parse(data.countries);
          if (Array.isArray(parsed)) {
            orgCountries = parsed;
          } else {
            orgCountries = [];
          }
        } catch (e) {
          orgCountries = data.countries.split(",").map((c: string) => c.trim());
        }
        const options = orgCountries.map((code: string) => {
          const found = allCountries.find((c) => c.code === code);
          return { value: code, label: found ? found.name : code };
        });
        setCountryOptions(options);
      } catch (error: any) {
        console.error("Error fetching organization countries:", error);
        toast.error(error.message || "Failed to load organization countries");
      }
    }
    fetchOrganizationCountries();
  }, []);

  // Reset form values when editing or on initial load.
  useEffect(() => {
    if (isEditing && announcementData) {
      form.reset({
        ...announcementData,
        // Ensure that countries is an array.
        countries: Array.isArray(announcementData.countries)
          ? announcementData.countries
          : typeof announcementData.countries === "string"
          ? JSON.parse(announcementData.countries)
          : [],// auto-set organization from session.
      });
      if (announcementData.deliveryDate) {
        const d = new Date(announcementData.deliveryDate);
        setDate(d);
        form.setValue("deliveryScheduled", true);
        setSwitchDelivery(true);
      } else {
        setDate(null);
        form.setValue("deliveryScheduled", false);
        setSwitchDelivery(false);
      }
    } else {
      form.reset({
        title: "",
        content: "",
        deliveryScheduled: false,
        deliveryDate: null,
        countries: [],
        status: "draft",
      });
      setDate(null);
      setSwitchDelivery(false);
    }
  }, [announcementData, form, isEditing]);

  async function onSubmit(values: AnnouncementFormValues) {
    setIsSubmitting(true);
    try {
      const url = isEditing
        ? `/api/announcements/${announcementData?.id}`
        : "/api/announcements";
      const response = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({
          title: values.title,
          content: values.content,
          deliveryDate: values.deliveryScheduled ? values.deliveryDate : null,
          countries: JSON.stringify(values.countries),
          status: values.status,
        }),
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

  const modules = {
    toolbar: [
      [{ header: [1, 2, false] }],
      ["bold", "italic", "underline", "strike", "blockquote"],
      [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
      ["link", "image"],
      ["clean"],
    ],
  };

  const formats = [
    "header",
    "bold",
    "italic",
    "underline",
    "strike",
    "blockquote",
    "list",
    "indent",
    "link",
    "image",
  ];

  return (
    <div className="w-full mx-auto border rounded-lg shadow-sm">
      <div className="p-6 pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Row 1: Title */}
              <div className="md:col-span-2">
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

              {/* Row 2: Content */}
              <div className="md:col-span-2">
                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Content *</FormLabel>
                      <FormControl>
                        <ReactQuill
                          theme="snow"
                          value={field.value}
                          onChange={(value) => {
                            field.onChange(value);
                          }}
                          modules={modules}
                          formats={formats}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 3: Country Select */}
              <div className="md:col-span-2">
                <FormField
                  control={form.control}
                  name="countries"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Countries *</FormLabel>
                      <FormControl>
                        <div>
                          <Select
                            isMulti
                            options={countryOptions}
                            placeholder="Select country(s)"
                            value={countryOptions.filter((option) =>
                              field.value.includes(option.value)
                            )}
                            onChange={(selectedOptions: any) =>
                              field.onChange(
                                selectedOptions.map((option: any) => option.value)
                              )
                            }
                            formatOptionLabel={(option: { value: string; label: string }) => (
                              <div className="flex items-center gap-2">
                                <ReactCountryFlag
                                  countryCode={option.value}
                                  svg
                                  style={{ width: "1.5em", height: "1.5em" }}
                                />
                                <span>{option.label}</span>
                              </div>
                            )}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 4: Status */}
              <div>
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status *</FormLabel>
                      <FormControl>
                        <Select
                          options={[
                            { value: "draft", label: "Draft" },
                            { value: "published", label: "Published" },
                          ]}
                          placeholder="Select status"
                          value={
                            field.value
                              ? {
                                  value: field.value,
                                  label:
                                    field.value.charAt(0).toUpperCase() +
                                    field.value.slice(1),
                                }
                              : null
                          }
                          onChange={(selectedOption: any) =>
                            field.onChange(selectedOption?.value || "")
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 5: Delivery Scheduling */}
              <div>
                <FormField
                  control={form.control}
                  name="deliveryScheduled"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormLabel>Schedule Delivery?</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={field.value}
                            onCheckedChange={(checked) => {
                              field.onChange(checked);
                              setSwitchDelivery(checked);
                            }}
                            className="mr-2"
                          />
                          <span>{field.value ? "Yes" : "No"}</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {form.watch("deliveryScheduled") && (
                  <FormField
                    control={form.control}
                    name="deliveryDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Delivery Date</FormLabel>
                        <FormControl>
                          <Popover open={openDatePicker} onOpenChange={setOpenDatePicker}>
                            <PopoverTrigger asChild>
                              <Button
                                variant={"outline"}
                                onClick={() => setOpenDatePicker(true)}
                                className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date ? format(date, "PPP") : "Pick a date"}
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
                                fromDate={new Date(new Date().setDate(new Date().getDate() + 1))}
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

              {/* Row 6: Limit Per User and Visibility */}
              <div>
                <FormField
                  control={form.control}
                  name="limitPerUser"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Limit Per User</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} placeholder="0" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div>
                <FormField
                  control={form.control}
                  name="visibility"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Visibility</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="mr-2"
                          />
                          <span>{field.value ? "Visible" : "Hidden"}</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Submit/Cancel Buttons */}
            <div className="flex justify-center gap-4 mt-6">
              <Button type="button" variant="outline" onClick={() => router.push("/announcements")}>
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
      </div>
    </div>
  );
}
