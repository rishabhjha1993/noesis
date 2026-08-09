import type { NoesisAnalysis } from "./types";

export const mockAnalysis: NoesisAnalysis = {
  title: "U.S. Energy Consumption, 2023",
  image_type: "Sankey diagram",
  central_question:
    "How does energy flow through the U.S. economy, and where is it ultimately used or lost?",
  overall_summary:
    "This diagram shows how primary energy sources flow through electricity generation and major economic sectors.",
  big_takeaway:
    "A much larger share of U.S. energy ends up as rejected energy than as useful energy services.",
  regions: [
    {
      id: "1",
      label: "Primary Energy Sources",
      x: 0.04,
      y: 0.08,
      width: 0.16,
      height: 0.78,
      sequence_order: 1,
      explanation: "Start with where energy enters the system.",
      why_it_matters:
        "Petroleum and natural gas dominate U.S. primary energy supply.",
      related_region_ids: ["2", "4"],
      relationship_explanation:
        "These sources feed electricity generation and direct end uses.",
      confidence: 0.98,
    },
    {
      id: "2",
      label: "Electricity Generation",
      x: 0.34,
      y: 0.1,
      width: 0.27,
      height: 0.26,
      sequence_order: 2,
      explanation: "This is a major conversion hub in the energy system.",
      why_it_matters:
        "A large amount of primary energy passes through electricity generation before reaching users.",
      related_region_ids: ["1", "5"],
      relationship_explanation:
        "Energy enters from several sources and part of it later appears as rejected energy.",
      confidence: 0.96,
    },
    {
      id: "3",
      label: "Natural Gas",
      x: 0.07,
      y: 0.27,
      width: 0.6,
      height: 0.28,
      sequence_order: 3,
      explanation: "Natural gas feeds several different parts of the economy.",
      why_it_matters:
        "It is used across electricity, buildings and industry rather than depending on one sector.",
      related_region_ids: ["2", "4"],
      relationship_explanation:
        "Its flows connect both conversion and direct-use sectors.",
      confidence: 0.95,
    },
    {
      id: "4",
      label: "Transportation",
      x: 0.48,
      y: 0.68,
      width: 0.3,
      height: 0.19,
      sequence_order: 4,
      explanation: "Transportation is heavily dependent on petroleum.",
      why_it_matters:
        "It represents one of the clearest fuel dependencies in the diagram.",
      related_region_ids: ["1", "5"],
      relationship_explanation:
        "Large petroleum flows enter transportation and much of that energy later appears as rejected energy.",
      confidence: 0.98,
    },
    {
      id: "5",
      label: "Rejected Energy",
      x: 0.76,
      y: 0.17,
      width: 0.21,
      height: 0.5,
      sequence_order: 5,
      explanation:
        "A large amount of energy never becomes useful energy services.",
      why_it_matters:
        "This is the visual's most important system-level insight.",
      related_region_ids: ["2", "4"],
      relationship_explanation:
        "Losses from electricity generation and transportation contribute heavily to this region.",
      confidence: 0.99,
    },
  ],
};
