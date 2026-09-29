export interface PlaceDTO {
  id: string;
  label: string;
  subtitle: string;
  lat: number;
  lng: number;
  kind: "home" | "work" | "recent" | "search" | "saved";
}

export interface EmergencyContactDTO {
  id: string;
  name: string;
  relation: string;
  phone: string;
  primary?: boolean;
}
