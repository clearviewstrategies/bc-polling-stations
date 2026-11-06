/**
 * Match a Canadian postal code to electoral districts that overlap its
 * census forward sortation area, then return the voting places recorded
 * for those districts.
 */

export const COMPACT_POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/;

export function compactPostal(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function formatPostal(compact) {
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

export function groupPlaces(places) {
  const finalPlaces = [];
  const advanceOnly = [];
  const offices = [];
  const other = [];
  for (const place of places || []) {
    const type = place.type || "";
    if (type === "DEO Office") offices.push(place);
    else if (type.includes("Final")) finalPlaces.push(place);
    else if (type.includes("Advance")) advanceOnly.push(place);
    else other.push(place);
  }
  const byName = (left, right) =>
    (left.building || "").localeCompare(right.building || "", "en") ||
    (left.address || "").localeCompare(right.address || "", "en");
  for (const list of [finalPlaces, advanceOnly, offices, other]) list.sort(byName);
  return { finalPlaces, advanceOnly, offices, other };
}

export function formatShare(share) {
  const percent = share * 100;
  if (percent < 0.1) return "less than 0.1%";
  if (percent < 1) return `${percent.toFixed(2)}%`;
  return `${percent.toFixed(1)}%`;
}

export function formatArea(squareMetres) {
  const squareKilometres = squareMetres / 1000000;
  if (squareKilometres < 0.1) return "under 0.1 km²";
  if (squareKilometres < 10) return `about ${squareKilometres.toFixed(1)} km²`;
  return `about ${Math.round(squareKilometres).toLocaleString("en-CA")} km²`;
}

export function wheelchairLabel(value) {
  if (value === "Y") return "Yes";
  if (value === "N") return "No";
  if (!value) return "Not stated in the source table";
  return value;
}

export function lookupPostal(dataset, raw) {
  const compact = compactPostal(raw);
  if (!compact) {
    return {
      ok: false,
      reason: "empty",
      message: "Enter a Canadian postal code.",
    };
  }
  if (!COMPACT_POSTAL.test(compact)) {
    return {
      ok: false,
      reason: "format",
      message: "Enter a Canadian postal code in the form A1A 1A1.",
    };
  }
  const fsa = compact.slice(0, 3);
  const postal = formatPostal(compact);
  const hits = dataset.fsas?.[fsa];
  if (!hits) {
    return {
      ok: true,
      matched: false,
      postal,
      fsa,
      message: `${fsa} is not in the Statistics Canada 2021 Census forward sortation area file for British Columbia. A newer postal code, a code from outside British Columbia, and a code with no census area all look the same here.`,
    };
  }
  const threshold = dataset.meta?.smallShareThreshold ?? 0.01;
  const areaLimit = dataset.meta?.smallAreaSqm ?? 2000000;
  const overlaps = hits.map((hit) => {
    const district = dataset.districts?.[hit.code];
    const places = district?.places || [];
    const band = hit.share >= threshold || hit.overlapSqm >= areaLimit ? "primary" : "small";
    return {
      code: hit.code,
      name: district?.name || hit.code,
      share: hit.share,
      overlapSqm: hit.overlapSqm,
      band,
      places,
      groups: groupPlaces(places),
    };
  });
  overlaps.sort((left, right) => right.share - left.share || left.name.localeCompare(right.name, "en"));
  return { ok: true, matched: true, postal, fsa, overlaps };
}
