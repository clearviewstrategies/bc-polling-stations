import assert from "node:assert/strict";
import test from "node:test";
import { compactPostal, formatArea, formatShare, groupPlaces, lookupPostal, wheelchairLabel } from "../src/match.js";

const dataset = {
  meta: { smallShareThreshold: 0.01, smallAreaSqm: 2000000 },
  districts: {
    ABM: {
      code: "ABM",
      name: "Abbotsford-Mission",
      places: [
        {
          id: 2,
          building: "Second School",
          address: "2 Example St",
          locality: "Abbotsford",
          type: "Advance Voting Place",
          wheelchair: "N",
          status: "Confirmed",
        },
        {
          id: 1,
          building: "First School",
          address: "1 Example St",
          locality: "Abbotsford",
          type: "Final Voting Place",
          wheelchair: "Y",
          status: "Confirmed",
        },
        {
          id: 3,
          building: "District office",
          address: "3 Example St",
          locality: "Abbotsford",
          type: "DEO Office",
          wheelchair: "",
          status: "Confirmed",
        },
      ],
    },
    ABS: {
      code: "ABS",
      name: "Abbotsford South",
      places: [
        {
          id: 4,
          building: "South School",
          address: "4 Example St",
          locality: "Abbotsford",
          type: "Advance Voting Place and Final Voting Place",
          wheelchair: "Y",
          status: "Confirmed",
        },
      ],
    },
  },
  fsas: {
    V2S: [
      { code: "ABS", share: 0.004, overlapSqm: 400 },
      { code: "ABM", share: 0.62, overlapSqm: 62000 },
    ],
  },
};

test("compacts a postal code", () => {
  assert.equal(compactPostal(" v2s-1a1 "), "V2S1A1");
});

test("rejects an empty or malformed postal code", () => {
  assert.equal(lookupPostal(dataset, "   ").reason, "empty");
  assert.equal(lookupPostal(dataset, "12345").reason, "format");
  assert.equal(lookupPostal(dataset, "V2S 1A").reason, "format");
});

test("reports an unknown forward sortation area without inventing districts", () => {
  const result = lookupPostal(dataset, "M5V 2H1");
  assert.equal(result.ok, true);
  assert.equal(result.matched, false);
  assert.equal(result.fsa, "M5V");
  assert.equal(result.overlaps, undefined);
});

test("orders overlapping districts and splits places by the published type", () => {
  const result = lookupPostal(dataset, "v2s1a1");
  assert.equal(result.matched, true);
  assert.equal(result.postal, "V2S 1A1");
  assert.deepEqual(
    result.overlaps.map((item) => item.code),
    ["ABM", "ABS"],
  );
  assert.equal(result.overlaps[0].band, "primary");
  assert.equal(result.overlaps[1].band, "small");
  assert.equal(result.overlaps[0].groups.finalPlaces[0].building, "First School");
  assert.equal(result.overlaps[0].groups.advanceOnly[0].building, "Second School");
  assert.equal(result.overlaps[0].groups.offices[0].type, "DEO Office");
  assert.equal(result.overlaps[1].groups.finalPlaces[0].type, "Advance Voting Place and Final Voting Place");
});

test("keeps a large rural overlap in the main list even when the share is under 1%", () => {
  const rural = structuredClone(dataset);
  rural.fsas.V0N = [{ code: "ABM", share: 0.008, overlapSqm: 250000000 }];
  const result = lookupPostal(rural, "V0N 1A1");
  assert.equal(result.overlaps[0].band, "primary");
});

test("formats shares, areas, and wheelchair values from the source codes", () => {
  assert.equal(formatShare(0.0004), "less than 0.1%");
  assert.equal(formatShare(0.004), "0.40%");
  assert.equal(formatShare(0.624), "62.4%");
  assert.equal(formatArea(38459), "under 0.1 km²");
  assert.equal(formatArea(1800000), "about 1.8 km²");
  assert.equal(formatArea(258432331), "about 258 km²");
  assert.equal(wheelchairLabel("Y"), "Yes");
  assert.equal(wheelchairLabel("N"), "No");
  assert.equal(wheelchairLabel(""), "Not stated in the source table");
  assert.equal(wheelchairLabel("Maybe"), "Maybe");
});

test("sorts grouped places by building name", () => {
  const groups = groupPlaces([
    { building: "Beta", address: "2 St", type: "Final Voting Place" },
    { building: "Alpha", address: "9 St", type: "Final Voting Place" },
  ]);
  assert.deepEqual(
    groups.finalPlaces.map((place) => place.building),
    ["Alpha", "Beta"],
  );
});
