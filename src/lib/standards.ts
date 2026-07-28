import type { Requirement, SiteFinding, SourceRegistryItem } from "./types";

export const sourceRegistry: SourceRegistryItem[] = [
  {
    id: "jones-civil",
    name: "Jones Civil public client reference library",
    type: "reference-library",
    url: "https://jonescivil.com/",
    use: "Find client pages and public reference documents selected by city/client."
  },
  {
    id: "brigham-standards",
    name: "Brigham City Public Works Standards",
    type: "city-standard",
    url: "https://jonescivil.com/clients/brigham-city/",
    use: "Baseline municipal standards for Brigham City reviews."
  },
  {
    id: "usgs-hazard",
    name: "USGS seismic hazard tools",
    type: "seismic-source",
    url: "https://www.usgs.gov/tools/unified-hazard-tool",
    use: "Screen seismic design inputs and flag where licensed structural review is needed."
  },
  {
    id: "fema-nfhl",
    name: "FEMA National Flood Hazard Layer",
    type: "flood-source",
    url: "https://www.fema.gov/flood-maps/national-flood-hazard-layer",
    use: "Screen mapped flood hazard layers for the project area."
  },
  {
    id: "nrcs-soils",
    name: "NRCS Web Soil Survey and Soil Data Access",
    type: "soil-source",
    url: "https://www.nrcs.usda.gov/resources/data-and-reports/web-soil-survey",
    use: "Screen soil conditions that may require geotechnical confirmation."
  }
];

export const clients = [
  {
    id: "brigham-city",
    name: "Brigham City",
    jurisdiction: "Brigham City",
    referenceDocs: [
      "Brigham City Public Works Standards - Jones Civil client page",
      "Brigham City Standards Text Only - public PDF"
    ]
  },
  {
    id: "lmrwd",
    name: "Lower Minnesota River Watershed District",
    jurisdiction: "Bloomington",
    referenceDocs: [
      "LMRWD_Engineering_Services_Proposal_5June2020_Young_Env.pdf",
      "McDonaldsRedevelopment_site.pdf"
    ]
  }
];

export const standardLibrary: Requirement[] = [
  {
    id: "brigham-geotech-required",
    clientId: "brigham-city",
    jurisdiction: "Brigham City",
    topic: "Geotechnical investigation",
    metric: "geotechnical_report_provided",
    comparator: "presence",
    value: true,
    sourceType: "city-standard",
    sourceTitle: "Brigham City Public Works Standards",
    citation:
      "Section 2.04 requires geotechnical investigation for qualifying subdivisions, commercial sites, public infrastructure, Sensitive Lands, or City Engineer request.",
    sourceUrl: "https://jonescivil.com/clients/brigham-city/",
    scopeTags: ["site-development", "roadway", "utility", "commercial"],
    rationale: "The geotechnical report can create stricter site-specific requirements."
  },
  {
    id: "brigham-road-base-depth",
    clientId: "brigham-city",
    jurisdiction: "Brigham City",
    topic: "Roadway section",
    metric: "aggregate_base_depth",
    comparator: "minimum",
    value: 8,
    unit: "in",
    sourceType: "city-standard",
    sourceTitle: "Brigham City Public Works Standards",
    citation: "Municipal roadway section baseline entered from public standards library.",
    sourceUrl: "https://jonescivil.com/clients/brigham-city/",
    scopeTags: ["roadway", "site-development", "commercial"],
    rationale: "City roadway section is the minimum unless a site report is stricter."
  },
  {
    id: "brigham-frost-depth",
    clientId: "brigham-city",
    jurisdiction: "Brigham City",
    topic: "Frost protection",
    metric: "frost_depth",
    comparator: "minimum",
    value: 42,
    unit: "in",
    sourceType: "city-standard",
    sourceTitle: "Brigham City Public Works Standards",
    citation: "Municipal frost protection baseline entered from public standards library.",
    sourceUrl: "https://jonescivil.com/clients/brigham-city/",
    scopeTags: ["roadway", "utility", "site-development", "commercial"],
    rationale: "City frost depth remains the floor when the site report is less strict."
  },
  {
    id: "city-groundwater-clearance",
    clientId: "lmrwd",
    jurisdiction: "Bloomington",
    topic: "Groundwater",
    metric: "groundwater_clearance",
    comparator: "minimum",
    value: 3,
    unit: "ft",
    sourceType: "city-standard",
    sourceTitle: "Bloomington stormwater baseline",
    citation: "Stormwater BMP siting baseline entered from public reference material.",
    scopeTags: ["stormwater", "site-development", "commercial"],
    rationale: "Stormwater features need vertical separation above seasonal high groundwater."
  },
  {
    id: "city-seismic-category",
    clientId: "lmrwd",
    jurisdiction: "Bloomington",
    topic: "Seismic",
    metric: "seismic_design_category",
    comparator: "presence",
    value: true,
    sourceType: "city-standard",
    sourceTitle: "Adopted building code checklist",
    citation: "Structural criteria must document seismic design category where applicable.",
    scopeTags: ["structure", "site-development", "commercial"],
    rationale: "Public hazard data can flag the need for structural confirmation."
  }
];

export const defaultSiteFindings: SiteFinding[] = [
  {
    id: "geo-road-base-depth",
    topic: "Roadway section",
    metric: "aggregate_base_depth",
    comparator: "minimum",
    value: 12,
    unit: "in",
    sourceType: "geotechnical-report",
    sourceTitle: "Uploaded geotechnical report",
    citation: "Site-specific pavement recommendation",
    rationale: "Poor soils require a deeper aggregate section than the city minimum."
  },
  {
    id: "geo-frost-depth",
    topic: "Frost protection",
    metric: "frost_depth",
    comparator: "minimum",
    value: 48,
    unit: "in",
    sourceType: "geotechnical-report",
    sourceTitle: "Uploaded geotechnical report",
    citation: "Site-specific frost recommendation",
    rationale: "Site conditions require deeper frost protection than the city minimum."
  }
];
