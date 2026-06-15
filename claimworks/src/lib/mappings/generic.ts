import type { ColumnMapping } from "../parse";

/** Generic mapping for a flat entry-line export. Clone + adjust per ABI system. */
export const genericMapping: ColumnMapping = {
  name: "generic-v1",
  columns: {
    entryNumber: "Entry Number",
    filerCode: "Filer Code",
    importerName: "Importer Name",
    iorNumber: "IOR Number",
    entryType: "Entry Type",
    entryDate: "Entry Date",
    portCode: "Port",
    liquidationStatus: "Liquidation Status",
    liquidationDate: "Liquidation Date",
    lineNumber: "Line",
    htsCode: "HTS",
    enteredValue: "Entered Value",
    dutyPaid: "Duty Paid",
    ieepaDutyPaid: "IEEPA Duty",
    reconciliationFlag: "Reconciliation",
    drawbackFlag: "Drawback",
    adcvdFlag: "ADCVD",
    openProtestFlag: "Open Protest",
  },
};
