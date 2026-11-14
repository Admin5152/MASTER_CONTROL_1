# Radiation evidence review

The 11 supplied PDFs were extracted locally with pypdf. Full extraction is in radiation_mrid_extracted.txt; original PDFs remain authoritative.

- MR004L p1: area dosimeters provide location-specific data; mission and accumulated doses support exposure assessment.
- MR004S: continuous personal passive dosimetry, including EVA; historical Shuttle requirement, not a Mars procedure.
- MR005L p4: continuous TEPC tissue dose/dose-equivalent monitoring, near-continuous telemetry and approximately weekly spectra review; high-dose-rate alarm and SRAG/flight-surgeon review.
- MR005S: Shuttle TEPC monitoring, not a current Mars/Moon dose threshold.
- MR092L p4: minute-by-minute RAD cyclic data for SRAG real-time operations and ALARA risk management.
- MR093L: IV-TEPC monitoring; station caution/warning integration.
- MR094L: active REM2 area-monitoring requirements.
- MEDB 3.1 describes radiation monitoring/personal dosimetry; MEDB 3.2 describes biodosimetry testing. Neither is a planetary shelter checklist.
- The MEDB 6 file is EVA medical monitoring, not a radiation dose-limits table.
- MEDB N3.04 p1 describes biodosimetry applicability for flights of two months or more or predicted effective dose exceeding 10 rem (100 mSv). That is not an allowable exposure limit.

## Boundaries

No reviewed MRID supplies the app's S3 shelter trigger, universal shielding factor, GOES-to-personal-dose conversion, or regional planetary radiation map. Those remain explicitly simulated demo defaults. Source-backed instrument frequencies must not be presented as actual instrument integration. Mission operations and flight rules control real shelter and clearance decisions.
