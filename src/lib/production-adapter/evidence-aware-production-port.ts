/**
 * Compatibility entry point for the evidence-aware production read port.
 *
 * Keep one implementation of this safety boundary. The canonical implementation
 * lives in evidence-aware-port.ts and is used by the live read path; this module
 * remains only so existing tests/imports do not create a second divergent port.
 */
export {
  createEvidenceAwareAirtableProductionPort,
  type EvidenceAwareAirtablePortConfig,
} from "./evidence-aware-port";
