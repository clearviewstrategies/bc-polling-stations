import { formatArea, formatShare, groupPlaces, lookupPostal, wheelchairLabel } from "./src/match.js";

const form = document.querySelector("#lookup-form");
const postalInput = document.querySelector("#postal");
const postalError = document.querySelector("#postal-error");
const result = document.querySelector("#result");
const districtSelect = document.querySelector("#district");
const districtResult = document.querySelector("#district-result");
const about = document.querySelector("#about");

let dataset = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(href, text) {
  const node = element("a", "", text);
  node.href = href;
  node.rel = "noopener noreferrer";
  return node;
}

function showError(message) {
  postalError.hidden = !message;
  postalError.textContent = message || "";
  postalInput.setAttribute("aria-invalid", message ? "true" : "false");
}

function placeArticle(place) {
  const article = element("article", "place");
  article.append(
    element("h5", "", place.building || place.address),
    element("p", "type", place.type || "Voting place"),
    element("p", "addr", [place.address, place.locality].filter(Boolean).join(", ")),
  );
  const facts = document.createElement("dl");
  const rows = [
    ["Wheelchair access indicator", wheelchairLabel(place.wheelchair)],
    ["Status", place.status || "Not stated in the source table"],
  ];
  for (const [label, value] of rows) {
    const wrap = element("div");
    wrap.append(element("dt", "", label), element("dd", "", value));
    facts.append(wrap);
  }
  article.append(facts);

  const details = document.createElement("details");
  details.append(element("summary", "", "Source details"));
  const list = document.createElement("dl");
  const extra = [
    ["Elections BC voting place id", place.id],
    ["Elections BC address id", place.addressId],
    ["Event date", place.eventDate],
    ["Status date", place.statusDate],
    ["Voter count in the source table", place.voterCount],
  ];
  if (place.tech?.advance) extra.push(["Advance technology type", place.tech.advance]);
  if (place.tech?.final) extra.push(["Final technology type", place.tech.final]);
  if (place.advanceFlags && place.advanceFlags.some((flag) => flag === "Y")) {
    extra.push([
      "Advance-day flags, day 1 to day 6, as published",
      place.advanceFlags.join(", "),
    ]);
  }
  if (place.lat !== undefined && place.lon !== undefined) {
    extra.push(["Published point latitude", String(place.lat)]);
    extra.push(["Published point longitude", String(place.lon)]);
  }
  for (const [label, value] of extra) {
    if (value === undefined || value === null || value === "") continue;
    const wrap = element("div");
    wrap.append(element("dt", "", label), element("dd", "", String(value)));
    list.append(wrap);
  }
  const pointNote = element(
    "p",
    "hint",
    place.advanceFlags?.some((flag) => flag === "Y")
      ? "Coordinates are the published building point, rounded to 6 decimal degrees. They are not a route. The advance-day flags are copied from the table, which does not name a calendar date for each flag."
      : "Coordinates are the published building point, rounded to 6 decimal degrees. They are not a route.",
  );
  details.append(list, pointNote);
  article.append(details);
  return article;
}

function renderGroups(parent, groups, { includeSecondary }) {
  const blocks = [
    ["Final voting places", groups.finalPlaces],
    ["Other records", groups.other],
  ];
  if (includeSecondary || groups.finalPlaces.length === 0) {
    blocks.push(
      ["Advance voting places", groups.advanceOnly],
      ["District electoral offices", groups.offices],
    );
  }
  let shown = 0;
  for (const [title, places] of blocks) {
    if (!places.length) continue;
    const section = element("section", "group");
    section.append(element("h4", "", title));
    if (title === "District electoral offices") {
      section.append(
        element(
          "p",
          "hint",
          "The source labels these records as district electoral offices, not as final voting places.",
        ),
      );
    }
    for (const place of places) section.append(placeArticle(place));
    parent.append(section);
    shown += places.length;
  }
  return shown;
}

function hiddenSecondaryCount(groups) {
  if (groups.finalPlaces.length === 0) return 0;
  return groups.advanceOnly.length + groups.offices.length;
}

function renderDistrictBlock(overlap, includeSecondary) {
  const section = element("section", "district");
  section.append(element("h3", "", `${overlap.name} (${overlap.code})`));
  const share = element(
    "p",
    "share",
    `${formatShare(overlap.share)} of this census forward sortation area overlaps this district (${formatArea(overlap.overlapSqm)}).`,
  );
  section.append(share);
  if (overlap.band === "small") {
    section.append(
      element(
        "p",
        "hint",
        "This overlap is under 1% of the census area and under 2 km². A very small overlap can be a boundary-alignment artifact.",
      ),
    );
  }
  const shown = renderGroups(section, overlap.groups, { includeSecondary });
  if (!shown) {
    section.append(
      element("p", "", "No 2026 voting place is recorded for this district in the packaged extract."),
    );
  }
  const hidden = includeSecondary ? 0 : hiddenSecondaryCount(overlap.groups);
  if (hidden) {
    section.append(
      element(
        "p",
        "hint",
        `${hidden} advance-only or district-electoral-office record${hidden === 1 ? "" : "s"} for this district ${hidden === 1 ? "is" : "are"} not shown.`,
      ),
    );
  }
  return section;
}

function renderPostalResult(query) {
  result.replaceChildren();
  if (!query.ok) {
    showError(query.message);
    return;
  }
  showError("");
  const heading = element("h2", "", query.postal);
  result.append(heading);

  heading.tabIndex = -1;
  if (!query.matched) {
    result.append(element("p", "", query.message));
    heading.focus();
    return;
  }

  const note = element("div", "note");
  const paragraphs = [
    `Matched on the census forward sortation area ${query.fsa} from the 2021 Census. The last three characters are not in an open file that connects a full postal code to a voting area, so they were checked for format only.`,
    "A census forward sortation area often covers many voting areas. Statistics Canada builds these areas from postal codes reported on census questionnaires. They are not Canada Post delivery areas.",
    "Elections BC says its boundary files should not be used to determine a voter’s electoral district or voting area. The districts below are those whose published boundaries overlap this census area. The places are the 2026 records Elections BC published for those districts. This is not the voting place printed on a Where to Vote card.",
    `${dataset.meta.votingClosedText} Final Voting Day hours published on the Where to Vote page: ${dataset.meta.finalVotingText}. ${dataset.meta.advanceVotingText}`,
  ];
  for (const text of paragraphs) note.append(element("p", "", text));
  const official = element("p");
  official.append(
    link(dataset.meta.whereToVoteTool, "Where to Vote tool"),
    element("span", "", " · "),
    link(dataset.meta.whereToVotePage, "Where to Vote page"),
    element(
      "span",
      "",
      `. Toll-free ${dataset.meta.phone}. TTY ${dataset.meta.tty}.`,
    ),
  );
  note.append(official);
  result.append(note);

  const primary = query.overlaps.filter((item) => item.band === "primary");
  const small = query.overlaps.filter((item) => item.band === "small");
  const extraBox = element("div", "panel extra-toggle");
  const extraId = "show-secondary";
  const extraLabel = element("label");
  extraLabel.htmlFor = extraId;
  const extra = document.createElement("input");
  extra.type = "checkbox";
  extra.id = extraId;
  extraLabel.append(extra, document.createTextNode(" Also show advance-only places and district electoral offices"));
  extraBox.append(extraLabel);
  const finalCount = query.overlaps.reduce((sum, item) => sum + item.groups.finalPlaces.length, 0);
  const hiddenCount = query.overlaps.reduce((sum, item) => sum + hiddenSecondaryCount(item.groups), 0);
  const covered = query.overlaps.reduce((sum, item) => sum + item.share, 0);
  let summary = `${query.overlaps.length} electoral district${query.overlaps.length === 1 ? "" : "s"} overlap ${query.fsa}. ${finalCount} final voting place record${finalCount === 1 ? "" : "s"}. ${hiddenCount} advance-only or district-electoral-office record${hiddenCount === 1 ? "" : "s"} can be shown with the checkbox.`;
  if (covered < 0.995) {
    summary += ` These overlaps cover ${formatShare(covered)} of the census area. The rest does not overlap a provincial electoral district in this boundary overlay.`;
  }
  extraBox.append(element("p", "hint", summary));
  result.append(extraBox);

  const list = element("div");
  result.append(list);

  function draw(includeSecondary) {
    list.replaceChildren();
    const source = primary.length ? primary : query.overlaps;
    for (const overlap of source) list.append(renderDistrictBlock(overlap, includeSecondary));
    if (primary.length && small.length) {
      const details = document.createElement("details");
      details.append(
        element(
          "summary",
          "",
          `${small.length} smaller overlap${small.length === 1 ? "" : "s"} under 1% of ${query.fsa} and under 2 km²`,
        ),
      );
      for (const overlap of small) details.append(renderDistrictBlock(overlap, includeSecondary));
      list.append(details);
    }
  }

  extra.addEventListener("change", () => draw(extra.checked));
  draw(false);
  heading.focus();
}

function renderBrowse(code) {
  districtResult.replaceChildren();
  if (!code || !dataset.districts[code]) return;
  const district = dataset.districts[code];
  const groups = groupPlaces(district.places);
  const section = element("section", "district");
  section.append(element("h3", "", `${district.name} (${district.code})`));
  if (district.gazetteDate) {
    section.append(element("p", "share", `Boundary gazette date published with this district: ${district.gazetteDate}.`));
  }
  const shown = renderGroups(section, groups, { includeSecondary: true });
  if (!shown) {
    section.append(element("p", "", "No 2026 voting place is recorded for this district in the packaged extract."));
  }
  districtResult.append(section);
}

function renderAbout() {
  const meta = dataset.meta;
  about.replaceChildren();
  about.append(element("h2", "", "Sources and limits"));
  about.append(
    element(
      "p",
      "",
      `Voting places and electoral districts were retrieved on ${meta.retrieved} from the BC Geographic Warehouse public services. Census forward sortation areas were retrieved the same day from Statistics Canada. ${meta.placeCount} voting-place records, ${meta.districtCount} electoral districts, and ${meta.fsaCount} British Columbia census forward sortation areas are packaged with this page.`,
    ),
  );
  if (!meta.catalogueCsvMatchesWfsCount) {
    about.append(
      element(
        "p",
        "",
        `The catalogue CSV extract contained ${meta.catalogueCsvPlaceCount} records for this event. The feature service contained ${meta.placeCount}. This page uses the feature service.`,
      ),
    );
  } else {
    about.append(
      element(
        "p",
        "",
        `A catalogue CSV of the same voting-place table, also retrieved on ${meta.retrieved}, contained the same count of records for this event (${meta.placeCount}).`,
      ),
    );
  }

  const list = document.createElement("ul");
  const sources = [
    [
      "Provincial Voting Places, Elections BC, WHSE_HUMAN_CULTURAL_ECONOMIC.EBC_VOTING_PLACES_SP. Event: 2026 Provincial General Election.",
      "https://catalogue.data.gov.bc.ca/dataset/2e12376d-f68c-4c33-ac4f-82d1b5a65dc2",
    ],
    [
      "Current Provincial Electoral Districts of British Columbia, Elections BC, WHSE_ADMIN_BOUNDARIES.EBC_PROV_ELECTORAL_DIST_SVW.",
      "https://catalogue.data.gov.bc.ca/dataset/current-provincial-electoral-districts-of-british-columbia",
    ],
    [
      "Statistics Canada, 2021 Census Forward Sortation Area Boundary File, catalogue 92-179-X, digital boundary file, British Columbia (PRUID 59).",
      "https://www150.statcan.gc.ca/n1/en/catalogue/92-179-X2021001",
    ],
    [
      "Elections BC, Where to Vote page for the 2026 provincial election, for hours and the statement that voting is closed.",
      meta.whereToVotePage,
    ],
    [
      "Elections BC, GIS spatial data note: boundary files should not be used to determine a voter’s electoral district or voting area.",
      "https://elections.bc.ca/resources/maps/gis-spatial-data/",
    ],
  ];
  for (const [text, href] of sources) {
    const item = document.createElement("li");
    item.append(link(href, text));
    list.append(item);
  }
  about.append(list);
  about.append(
    element(
      "p",
      "",
      "Contains information licenced under the Elections BC Open Data Licence. Contains information licensed under the Open Government Licence – Canada.",
    ),
  );
  const licence = element("p");
  licence.append(
    link("https://www.elections.bc.ca/docs/EBC-Open-Data-Licence.pdf", "Elections BC Open Data Licence"),
    element("span", "", " · "),
    link("https://open.canada.ca/en/open-government-licence-canada", "Open Government Licence – Canada"),
  );
  about.append(licence);
  about.append(
    element(
      "p",
      "",
      "Postal code is an official mark of Canada Post Corporation. This page is not an Elections BC service and is not endorsed by Elections BC or Statistics Canada.",
    ),
  );
  about.append(
    element(
      "p",
      "",
      "Not included: the voting-area to voting-place assignment table. Elections BC publishes it for 2026, but the public catalogue offers it through an emailed warehouse order rather than a direct download, and no 2026 spatial assignment layer was found on the public map services. The 2024 assignment layer was not used in its place. Full six-character postal codes are not an open dataset, so this page cannot identify the one voting place assigned to an address.",
    ),
  );
}

async function init() {
  try {
    const response = await fetch(new URL("./data/lookup.json", import.meta.url));
    if (!response.ok) throw new Error(String(response.status));
    dataset = await response.json();
  } catch {
    result.append(
      element(
        "p",
        "error",
        "The voting-place file did not load. From this folder, run a local web server and open the site from that server.",
      ),
    );
    return;
  }

  const districts = Object.values(dataset.districts).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
  for (const district of districts) {
    const option = element("option", "", `${district.name} (${district.code})`);
    option.value = district.code;
    districtSelect.append(option);
  }
  renderAbout();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!dataset) return;
  renderPostalResult(lookupPostal(dataset, postalInput.value));
});

districtSelect.addEventListener("change", () => renderBrowse(districtSelect.value));

init();
