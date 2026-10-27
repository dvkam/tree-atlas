import { z } from "zod";

// Registration permits validation; only an acquired, licensed manifest entry enables a location.
export const locations = [
  { id: "vienna", city: "Vienna", country: "Austria" },
  { id: "geneva", city: "Geneva", country: "Switzerland" },
  { id: "porto", city: "Porto", country: "Portugal" },
  { id: "amsterdam", city: "Amsterdam", country: "Netherlands" },
  { id: "hamburg", city: "Hamburg", country: "Germany" },
  { id: "zurich", city: "Zürich", country: "Switzerland" },
  { id: "london", city: "London", country: "United Kingdom" },
  { id: "camden", city: "Camden", country: "United Kingdom" },
  { id: "edinburgh", city: "Edinburgh", country: "United Kingdom" },
  { id: "belfast", city: "Belfast", country: "United Kingdom" },
  { id: "barcelona", city: "Barcelona", country: "Spain" },
  { id: "madrid", city: "Madrid", country: "Spain" },
  { id: "valencia", city: "Valencia", country: "Spain" },
  { id: "milan", city: "Milan", country: "Italy" },
  { id: "florence", city: "Florence", country: "Italy" },
  { id: "bologna", city: "Bologna", country: "Italy" },
  { id: "turin", city: "Turin", country: "Italy" },
  { id: "basel", city: "Basel-Stadt", country: "Switzerland" },
  { id: "bern", city: "Bern", country: "Switzerland" },
  { id: "paris", city: "Paris", country: "France" },
  { id: "lyon", city: "Lyon Métropole", country: "France" },
  { id: "toulouse", city: "Toulouse", country: "France" },
  { id: "bordeaux", city: "Bordeaux Métropole", country: "France" },
  { id: "strasbourg", city: "Strasbourg", country: "France" },
  { id: "rennes", city: "Rennes", country: "France" },
  { id: "montpellier", city: "Montpellier", country: "France" },
  { id: "lisbon", city: "Lisbon", country: "Portugal" },
  { id: "cascais", city: "Cascais", country: "Portugal" },
  { id: "berlin", city: "Berlin", country: "Germany" },
  { id: "leipzig", city: "Leipzig", country: "Germany" },
  { id: "cologne", city: "Cologne", country: "Germany" },
  { id: "rostock", city: "Rostock", country: "Germany" },
  { id: "frankfurt", city: "Frankfurt", country: "Germany" },
  { id: "ghent", city: "Ghent", country: "Belgium" },
  { id: "liege", city: "Liège", country: "Belgium" },
  { id: "brussels", city: "Brussels remarkable trees", country: "Belgium" },
  { id: "utrecht", city: "Utrecht", country: "Netherlands" },
  { id: "eindhoven", city: "Eindhoven", country: "Netherlands" },
  { id: "arnhem", city: "Arnhem", country: "Netherlands" },
  { id: "delft", city: "Delft", country: "Netherlands" },
  { id: "rotterdam", city: "Rotterdam", country: "Netherlands" },
  { id: "luxembourg", city: "Luxembourg City", country: "Luxembourg" },
  { id: "luxembourgnational", city: "Luxembourg remarkable trees", country: "Luxembourg" },
  { id: "gdansk", city: "Gdańsk", country: "Poland" },
  { id: "wroclaw", city: "Wrocław", country: "Poland" },
  { id: "poznan", city: "Poznań", country: "Poland" },
  { id: "warsaw", city: "Warsaw", country: "Poland" },
  { id: "antwerp", city: "Antwerp", country: "Belgium" },
  { id: "nantes", city: "Nantes", country: "France" },
] as const;
export const datasetIdSchema = z.enum(locations.map((location) => location.id));
export type DatasetId = z.infer<typeof datasetIdSchema>;
export function locationDefinition(id: DatasetId) {
  const location = locations.find((item) => item.id === id);
  if (location === undefined) throw new Error(`Unknown inventory: ${id}`);
  return location;
}
