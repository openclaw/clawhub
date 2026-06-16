import { PLUGIN_CATEGORY_DEFINITIONS, SKILL_CATEGORY_DEFINITIONS } from "clawhub-schema";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type CatalogMetadataFieldsProps = {
  kind: "skill" | "plugin";
  primaryCategory: string;
  topics: string;
  disabled?: boolean;
  onPrimaryCategoryChange: (value: string) => void;
  onTopicsChange: (value: string) => void;
};

const AUTO_CATEGORY_VALUE = "__auto__";

export function parseCatalogTopicsInput(value: string) {
  return value
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

export function CatalogMetadataFields({
  kind,
  primaryCategory,
  topics,
  disabled,
  onPrimaryCategoryChange,
  onTopicsChange,
}: CatalogMetadataFieldsProps) {
  const categories = kind === "skill" ? SKILL_CATEGORY_DEFINITIONS : PLUGIN_CATEGORY_DEFINITIONS;
  const prefix = kind === "skill" ? "skill" : "plugin";

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${prefix}PrimaryCategory`}>Primary category</Label>
        <Select
          value={primaryCategory || AUTO_CATEGORY_VALUE}
          disabled={disabled}
          onValueChange={(value) =>
            onPrimaryCategoryChange(value === AUTO_CATEGORY_VALUE ? "" : value)
          }
        >
          <SelectTrigger id={`${prefix}PrimaryCategory`}>
            <SelectValue placeholder="Auto-detect" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO_CATEGORY_VALUE}>Auto-detect</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.slug} value={category.slug}>
                {category.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${prefix}Topics`}>Topics</Label>
        <Input
          id={`${prefix}Topics`}
          value={topics}
          disabled={disabled}
          onChange={(event) => onTopicsChange(event.target.value)}
          placeholder="email, calendar, productivity"
        />
      </div>
    </>
  );
}
