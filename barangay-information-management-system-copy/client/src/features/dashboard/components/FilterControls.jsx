import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Filter } from "lucide-react";
import { months, years } from "@/constants/dashboardConstants";
import ReactSelect from "@/components/ui/react-select";

// puroks removed in v2 — selectedPurok/setSelectedPurok/puroks props are no longer used
const FilterControls = ({
  role,
  selectedBarangay,
  setSelectedBarangay,
  barangays,
}) => {
  // Prepare barangay options for React Select
  const barangayOptions = [
    { value: "all", label: "All Barangays" }
  ];

  if (Array.isArray(barangays)) {
    barangays.forEach((barangay) => {
      barangayOptions.push({
        value: barangay.id.toString(),
        label: barangay.barangay_name
      });
    });
  }

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Data Filters
        </CardTitle>
        <CardDescription>
          Customize your dashboard view with filters
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 flex-wrap">
          {role === "municipality" && (
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block">Barangay</label>
              <ReactSelect
                value={barangayOptions.find(option =>
                  option.value === (selectedBarangay || "all")
                )}
                onChange={(selectedOption) => {
                  setSelectedBarangay(selectedOption.value === "all" ? null : selectedOption.value);
                }}
                options={barangayOptions}
                placeholder="Select barangay"
                isClearable={false}
              />
            </div>
          )}
          {/* Purok filter removed — puroks table dropped in v2 */}
        </div>
      </CardContent>
    </Card>
  );
};

export default FilterControls;
