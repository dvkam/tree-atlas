import type { Dataset, DatasetId } from "./domain.ts";

type Props = {
  datasets: readonly Dataset[];
  selected: DatasetId;
  onChange: (dataset: Dataset) => void;
};
export function LocationPicker({ datasets, selected, onChange }: Props) {
  const countries = [...new Set(datasets.map((dataset) => dataset.country))].sort();
  return (
    <nav aria-label="Inventory locations">
      {datasets.length <= 12 ? (
        <div className="cities">
          {datasets.map((dataset) => (
            <button
              key={dataset.id}
              aria-pressed={dataset.id === selected}
              onClick={() => onChange(dataset)}
            >
              {dataset.city}
              <span>{dataset.country}</span>
            </button>
          ))}
        </div>
      ) : (
        <label className="inventory-picker">
          <span>Inventory location</span>
          <select
            value={selected}
            onChange={(event) => {
              const dataset = datasets.find((item) => item.id === event.target.value);
              if (dataset !== undefined) onChange(dataset);
            }}
          >
            {countries.map((country) => (
              <optgroup key={country} label={country}>
                {datasets
                  .filter((dataset) => dataset.country === country)
                  .toSorted((a, b) => a.city.localeCompare(b.city))
                  .map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.city}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
    </nav>
  );
}
